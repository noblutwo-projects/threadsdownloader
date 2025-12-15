import { Elysia, t } from 'elysia';
import fs from 'fs-extra';
import path from 'path';
import { swaggerPlugin } from './plugins';

// ==================== CONFIG ====================
const CONFIG = {
  PORT: parseInt(process.env.PORT || '3000'),
  DEFAULT_QUALITY: process.env.DEFAULT_QUALITY || '720p',
};

// ==================== USER CONFIG STORE ====================
interface DownloadConfig {
  folderName: string;      // Tên thư mục user chọn (vd: "Downloads", "Desktop")
  lastDownload?: string;   // File cuối cùng đã tải
  updatedAt: Date;
}

// Lưu config theo session ID
const userConfigs: Map<string, DownloadConfig> = new Map();

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
const app = new Elysia()
  .use(swaggerPlugin)

  // API Info
  .get('/', () => {
    return {
      name: 'Video Downloader API',
      version: '1.0.0',
      description: 'API de tai video tu cac nen tang nhu YouTube, Facebook, TikTok...',
      endpoints: {
        'POST /video/info': 'Lay thong tin video',
        'POST /download/stream': 'Tai video va stream truc tiep ve client',
        'POST /config/folder': 'Luu thong tin thu muc user da chon',
        'GET /config/folder': 'Lay thong tin thu muc hien tai',
        'GET /config/folder/:sessionId': 'Lay thong tin thu muc theo session',
      },
      qualityOptions: ['best', '1080p', '720p', '480p', '360p', 'audio'],
      supportedPlatforms: SUPPORTED_PLATFORMS,
      swagger: '/swagger',
    };
  }, {
    detail: {
      tags: ['API'],
      summary: 'Thong tin API',
    }
  })

  // ==================== CONFIG ENDPOINTS ====================

  // Lưu thông tin thư mục user đã chọn
  .post('/config/folder', ({ body }) => {
    const { sessionId, folderName } = body;

    if (!sessionId || !folderName) {
      return { error: 'sessionId va folderName la bat buoc' };
    }

    userConfigs.set(sessionId, {
      folderName,
      updatedAt: new Date(),
    });

    console.log(`Session ${sessionId} set folder: ${folderName}`);

    return {
      success: true,
      sessionId,
      folderName,
      message: `Da luu thu muc: ${folderName}`,
    };
  }, {
    detail: {
      tags: ['Config'],
      summary: 'Luu thong tin thu muc download',
    },
    body: t.Object({
      sessionId: t.String(),
      folderName: t.String(),
    })
  })

  // Lấy thông tin thư mục theo sessionId
  .get('/config/folder/:sessionId', ({ params }) => {
    const { sessionId } = params;
    const config = userConfigs.get(sessionId);

    if (!config) {
      return {
        sessionId,
        folderName: null,
        message: 'Chua chon thu muc luu file',
      };
    }

    return {
      sessionId,
      folderName: config.folderName,
      lastDownload: config.lastDownload,
      updatedAt: config.updatedAt,
    };
  }, {
    detail: {
      tags: ['Config'],
      summary: 'Lay thong tin thu muc theo session',
    }
  })

  // Cập nhật file đã tải cuối cùng
  .post('/config/download-complete', ({ body }) => {
    const { sessionId, fileName } = body;

    const config = userConfigs.get(sessionId);
    if (config) {
      config.lastDownload = fileName;
      config.updatedAt = new Date();
    }

    return {
      success: true,
      sessionId,
      fileName,
      folderName: config?.folderName,
      message: config
        ? `File "${fileName}" da duoc luu vao "${config.folderName}"`
        : `File "${fileName}" da duoc tai`,
    };
  }, {
    detail: {
      tags: ['Config'],
      summary: 'Cap nhat thong tin file da tai',
    },
    body: t.Object({
      sessionId: t.String(),
      fileName: t.String(),
    })
  })

  // ==================== VIDEO ENDPOINTS ====================

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

  // Stream download - download video and stream directly to client
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
      summary: 'Tai video va stream truc tiep ve client',
      description: 'Tai video va stream truc tiep ve client. Frontend se nhan stream va luu file vao thu muc user chon.',
    },
    body: t.Object({
      url: t.String(),
      quality: t.Optional(t.String())
    })
  })

  .listen(CONFIG.PORT);

console.log(`🚀 Video Downloader API is running on http://localhost:${CONFIG.PORT}`);
console.log(`📚 Swagger UI available at http://localhost:${CONFIG.PORT}/swagger`);
