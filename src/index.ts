import { Elysia, t } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import fs from 'fs-extra';
import path from 'path';
import { swaggerPlugin } from './plugins';

// ==================== CONFIG ====================
// Bun tự động load .env file
const CONFIG = {
  PORT: parseInt(process.env.PORT || '3000'),
  DOWNLOAD_DIR: process.env.DOWNLOAD_DIR || './downloads',
  CLEANUP_MAX_AGE: parseInt(process.env.CLEANUP_MAX_AGE || '3600000'),
  DEFAULT_QUALITY: process.env.DEFAULT_QUALITY || '720p',
};

// Resolve download directory to absolute path (thư mục tạm trên server)
function getDownloadsDir(): string {
  const dir = CONFIG.DOWNLOAD_DIR;
  if (dir.startsWith('./') || dir.startsWith('../') || !path.isAbsolute(dir)) {
    return path.resolve(process.cwd(), dir);
  }
  return dir;
}

console.log('📁 Download directory:', getDownloadsDir());

// ==================== TYPES ====================
type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'error';

interface DownloadProgress {
  status: DownloadStatus;
  progress: number;
  message: string;
  filename?: string;
  downloadUrl?: string;
  size?: string;
  title?: string;
  speed?: string;
  eta?: string;
}

// ==================== STORE ====================
const downloadProgress: Map<string, DownloadProgress> = new Map();

// ==================== UTILS ====================
function isValidUrl(string: string): boolean {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

const SUPPORTED_PLATFORMS = [
  'youtube.com', 'youtu.be', 'www.youtube.com',
  'facebook.com', 'www.facebook.com', 'fb.watch',
  'instagram.com', 'www.instagram.com',
  'tiktok.com', 'www.tiktok.com',
  'twitter.com', 'x.com', 'www.twitter.com', 'www.x.com',
  'vimeo.com', 'www.vimeo.com',
  'dailymotion.com', 'www.dailymotion.com'
];

function isSupportedPlatform(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return SUPPORTED_PLATFORMS.some(platform =>
      urlObj.hostname.includes(platform)
    );
  } catch (_) {
    return false;
  }
}

function getYtDlpPath(): string {
  const localPath = path.join(process.cwd(), 'yt-dlp');
  if (fs.existsSync(localPath)) {
    return localPath;
  }
  return 'yt-dlp';
}

function generateDownloadId(): string {
  return `dl_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function cleanupOldFiles() {
  // Nếu CLEANUP_MAX_AGE = 0, không tự động xóa
  if (CONFIG.CLEANUP_MAX_AGE <= 0) return;

  const downloadsDir = getDownloadsDir();
  try {
    await fs.ensureDir(downloadsDir);
    const files = await fs.readdir(downloadsDir);
    const now = Date.now();

    for (const file of files) {
      const filePath = path.join(downloadsDir, file);
      const stats = await fs.stat(filePath);
      if (now - stats.mtime.getTime() > CONFIG.CLEANUP_MAX_AGE) {
        await fs.remove(filePath);
        console.log(`Cleaned up old file: ${file}`);
      }
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

// ==================== YT-DLP FUNCTIONS ====================
async function execYtDlp(args: string[]): Promise<string> {
  const ytDlpPath = getYtDlpPath();
  const proc = Bun.spawn([ytDlpPath, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(stderr || stdout || 'yt-dlp command failed');
  }

  return stdout;
}

async function execYtDlpWithProgress(args: string[], downloadId: string): Promise<void> {
  const ytDlpPath = getYtDlpPath();
  const proc = Bun.spawn([ytDlpPath, '--newline', '--progress', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n');

      for (const line of lines) {
        const currentProgress = downloadProgress.get(downloadId);
        if (!currentProgress) continue;

        // Parse progress percentage
        const progressMatch = line.match(/(\d+\.?\d*)%/);
        if (progressMatch && progressMatch[1]) {
          currentProgress.progress = parseFloat(progressMatch[1]);
        }

        // Parse speed
        const speedMatch = line.match(/(\d+\.?\d*\s*[KMG]?i?B\/s)/i);
        if (speedMatch && speedMatch[1]) {
          currentProgress.speed = speedMatch[1];
        }

        // Parse ETA
        const etaMatch = line.match(/ETA\s+(\d+:\d+)/);
        if (etaMatch && etaMatch[1]) {
          currentProgress.eta = etaMatch[1];
        }

        // Update message
        if (currentProgress.progress > 0) {
          currentProgress.message = `Đang tải: ${currentProgress.progress.toFixed(1)}%`;
          if (currentProgress.speed) {
            currentProgress.message += ` (${currentProgress.speed})`;
          }
          if (currentProgress.eta) {
            currentProgress.message += ` - ETA: ${currentProgress.eta}`;
          }
        }

        console.log('[yt-dlp]', line);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(stderr || 'yt-dlp command failed');
  }
}


// ==================== QUALITY PRESETS ====================
const QUALITY_PRESETS: Record<string, string> = {
  'best': 'best',
  '1080p': 'best[height<=1080][ext=mp4]/best[height<=1080]/best',
  '720p': 'best[height<=720][ext=mp4]/best[height<=720]/best',
  '480p': 'best[height<=480][ext=mp4]/best[height<=480]/best',
  '360p': 'best[height<=360][ext=mp4]/best[height<=360]/best',
  'audio': 'bestaudio[ext=m4a]/bestaudio',
};

// ==================== APP ====================
// Ensure download directory exists
fs.ensureDirSync(getDownloadsDir());

const app = new Elysia()
  .use(swaggerPlugin)
  .use(staticPlugin({
    assets: getDownloadsDir(),
    prefix: '/downloads'
  }))

  // API Info
  .get('/', () => {
    return {
      name: 'Video Downloader API',
      version: '1.0.0',
      description: 'API de tai video tu cac nen tang nhu YouTube, Facebook, TikTok...',
      endpoints: {
        'POST /video/info': 'Lay thong tin video',
        'POST /download/stream': 'Tai video va stream truc tiep ve client',
        'POST /download': 'Bat dau tai video (luu tren server tam thoi)',
        'GET /download/status/:downloadId': 'Kiem tra trang thai tai',
        'GET /files': 'Danh sach file da tai',
      },
      supportedPlatforms: SUPPORTED_PLATFORMS,
      swagger: '/swagger',
    };
  }, {
    detail: {
      tags: ['API'],
      summary: 'Thong tin API',
    }
  })

  // Get video info
  .post('/video/info', async ({ body }) => {
    try {
      const { url } = body;

      if (!url || !isValidUrl(url)) {
        return { error: 'URL khong hop le' };
      }

      if (!isSupportedPlatform(url)) {
        return { error: 'Nen tang khong duoc ho tro' };
      }

      console.log(`Getting video info: ${url}`);

      const output = await execYtDlp([
        '--dump-json',
        '--no-download',
        '--no-warnings',
        url
      ]);

      const info = JSON.parse(output);
      const duration = info.duration
        ? `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')}`
        : 'Unknown';

      return {
        title: info.title || 'Unknown',
        duration,
        uploader: info.uploader || info.channel || 'Unknown',
        thumbnail: info.thumbnail,
      };
    } catch (error) {
      console.error('Get info error:', error);
      return { error: 'Khong the lay thong tin video' };
    }
  }, {
    detail: {
      tags: ['Video'],
      summary: 'Lay thong tin video',
    },
    body: t.Object({
      url: t.String()
    })
  })

  // Start download
  .post('/download', async ({ body }) => {
    try {
      const { url, quality } = body;
      const selectedQuality = quality ?? '720p';

      if (!url || !isValidUrl(url)) {
        return { error: 'URL khong hop le' };
      }

      if (!isSupportedPlatform(url)) {
        return { error: 'Nen tang khong duoc ho tro' };
      }

      const downloadsDir = getDownloadsDir();
      await fs.ensureDir(downloadsDir);
      await cleanupOldFiles();

      const downloadId = generateDownloadId();
      const formatString: string = QUALITY_PRESETS[selectedQuality] ?? QUALITY_PRESETS['720p'] ?? 'best[height<=720]/best';

      // Initialize progress
      downloadProgress.set(downloadId, {
        status: 'downloading',
        progress: 0,
        message: 'Bat dau tai...',
      });

      console.log(`Starting download [${downloadId}]: ${url}`);

      // Start download in background
      (async () => {
        try {
          const args: string[] = [
            '-f', formatString,
            '-o', path.join(downloadsDir, '%(title)s.%(ext)s'),
            '--restrict-filenames',
            '--concurrent-fragments', '8',
            '--no-warnings',
            '--no-playlist',
            url
          ];

          await execYtDlpWithProgress(args, downloadId);

          // Find the downloaded file
          const files = await fs.readdir(downloadsDir);
          const latestFile = files
            .map(f => ({ name: f, time: fs.statSync(path.join(downloadsDir, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time)[0];

          if (latestFile) {
            const filePath = path.join(downloadsDir, latestFile.name);
            const stats = await fs.stat(filePath);

            downloadProgress.set(downloadId, {
              status: 'completed',
              progress: 100,
              message: 'Tai thanh cong!',
              filename: latestFile.name,
              downloadUrl: `/download-file/${encodeURIComponent(latestFile.name)}`,
              size: formatFileSize(stats.size),
            });
          } else {
            throw new Error('Khong tim thay file');
          }
        } catch (error) {
          console.error('Download error:', error);
          downloadProgress.set(downloadId, {
            status: 'error',
            progress: 0,
            message: error instanceof Error ? error.message : 'Loi khong xac dinh',
          });
        }
      })();

      return { downloadId, message: 'Dang tai video...' };
    } catch (error) {
      console.error('Download error:', error);
      return { error: 'Khong the tai video' };
    }
  }, {
    detail: {
      tags: ['Download'],
      summary: 'Tai video tu URL',
    },
    body: t.Object({
      url: t.String(),
      quality: t.Optional(t.String())
    })
  })

  // Get download status
  .get('/download/status/:downloadId', ({ params }) => {
    const { downloadId } = params;
    const progress = downloadProgress.get(downloadId);

    if (!progress) {
      return { error: 'Download ID khong ton tai' };
    }

    return progress;
  }, {
    detail: {
      tags: ['Download'],
      summary: 'Kiem tra trang thai tai',
    }
  })

  // Download file
  .get('/download-file/:filename', async ({ params }) => {
    try {
      const { filename } = params;
      const decodedFilename = decodeURIComponent(filename);
      const filePath = path.join(getDownloadsDir(), decodedFilename);

      if (!(await fs.pathExists(filePath))) {
        return new Response('File not found', { status: 404 });
      }

      const file = Bun.file(filePath);
      const stat = await fs.stat(filePath);

      return new Response(file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'Content-Length': stat.size.toString(),
          'Content-Disposition': `attachment; filename="${decodedFilename}"`,
        }
      });
    } catch (error) {
      return new Response('Internal server error', { status: 500 });
    }
  }, {
    detail: {
      tags: ['Files'],
      summary: 'Tai file video',
    }
  })

  // Stream download - download video and stream directly to client without saving to server
  .post('/download/stream', async ({ body }) => {
    try {
      const { url, quality } = body;
      const selectedQuality = quality ?? '720p';

      if (!url || !isValidUrl(url)) {
        return new Response(JSON.stringify({ error: 'URL khong hop le' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (!isSupportedPlatform(url)) {
        return new Response(JSON.stringify({ error: 'Nen tang khong duoc ho tro' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      console.log(`Starting stream download: ${url}`);

      // Get video info first for filename
      const infoOutput = await execYtDlp([
        '--dump-json',
        '--no-download',
        '--no-warnings',
        url
      ]);
      const info = JSON.parse(infoOutput);

      const formatString: string = QUALITY_PRESETS[selectedQuality] ?? QUALITY_PRESETS['720p'] ?? 'best[height<=720]/best';

      // Create a temporary file to download to, then stream it
      const tempDir = path.join(process.cwd(), '.temp');
      await fs.ensureDir(tempDir);

      const safeTitle = (info.title || 'video').replace(/[^a-zA-Z0-9_\-\s]/g, '_').substring(0, 100);
      const ext = selectedQuality === 'audio' ? 'm4a' : 'mp4';
      const tempFilename = `${Date.now()}_${safeTitle}.${ext}`;
      const tempFilePath = path.join(tempDir, tempFilename);

      // Download to temp file
      const ytDlpPath = getYtDlpPath();
      const args: string[] = [
        '-f', formatString,
        '-o', tempFilePath,
        '--restrict-filenames',
        '--concurrent-fragments', '8',
        '--no-warnings',
        '--no-playlist',
        url
      ];

      const proc = Bun.spawn([ytDlpPath, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      await proc.exited;

      // Check if file exists
      if (!(await fs.pathExists(tempFilePath))) {
        return new Response(JSON.stringify({ error: 'Khong the tai video' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get file stats
      const stats = await fs.stat(tempFilePath);
      const file = Bun.file(tempFilePath);

      // Create filename for download
      const downloadFilename = `${safeTitle}.${ext}`;

      // Stream the file to client
      const response = new Response(file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'Content-Length': stats.size.toString(),
          'Content-Disposition': `attachment; filename="${downloadFilename}"`,
        }
      });

      // Clean up temp file after response is sent (delayed)
      setTimeout(async () => {
        try {
          await fs.remove(tempFilePath);
          console.log(`Cleaned up temp file: ${tempFilename}`);
        } catch (e) {
          console.error('Error cleaning up temp file:', e);
        }
      }, 60000); // Delete after 1 minute

      return response;

    } catch (error) {
      console.error('Stream download error:', error);
      return new Response(JSON.stringify({ error: 'Khong the tai video' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }, {
    detail: {
      tags: ['Download'],
      summary: 'Stream download video truc tiep ve client',
      description: 'Tai video va stream truc tiep ve client, khong luu tren server',
    },
    body: t.Object({
      url: t.String(),
      quality: t.Optional(t.String())
    })
  })

  // List files
  .get('/files', async () => {
    try {
      const downloadsDir = getDownloadsDir();
      await fs.ensureDir(downloadsDir);

      const files = await fs.readdir(downloadsDir);
      const fileList = await Promise.all(
        files.map(async (name) => {
          const filePath = path.join(downloadsDir, name);
          const stats = await fs.stat(filePath);
          return {
            name,
            size: formatFileSize(stats.size),
            downloadUrl: `/download-file/${encodeURIComponent(name)}`,
            createdAt: stats.mtime,
          };
        })
      );

      return fileList.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch (error) {
      return { error: 'Khong the lay danh sach file' };
    }
  }, {
    detail: {
      tags: ['Files'],
      summary: 'Danh sach file da tai',
    }
  })


  .listen(CONFIG.PORT);

console.log(`🚀 Video Downloader server is running on http://localhost:${CONFIG.PORT}`);
console.log(`📚 Swagger UI available at http://localhost:${CONFIG.PORT}/swagger`);
console.log(`📁 Files will be saved to: ${getDownloadsDir()}`);
