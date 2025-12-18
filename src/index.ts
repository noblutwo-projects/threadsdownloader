import { Elysia, t } from 'elysia';
import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import { swaggerPlugin } from './plugins';
import { cors } from "@elysiajs/cors";
import { getThreadsMedia, getThreadsVideoInfo, extractThreadsEmbeddedUrl } from './threads-scraper';

const CONFIG = {
  PORT: parseInt(process.env.PORT || '3000'),
  // Use home directory for temp files (snap ffmpeg cannot access /tmp)
  TEMP_DIR: path.join(process.env.HOME || '/tmp', '.video-downloads-temp'),
};

// ==================== HELPERS ====================
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
  'dailymotion.com', 'www.dailymotion.com',
  'threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'
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

function isThreadsUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('threads.net') || urlObj.hostname.includes('threads.com');
  } catch {
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
// Add deno and common paths to PATH for yt-dlp JavaScript runtime and ffmpeg
const DENO_PATH = `${process.env.HOME}/.deno/bin`;
const EXTRA_PATHS = '/snap/bin:/usr/local/bin:/usr/bin';
const ENV_WITH_DENO = {
  ...process.env,
  PATH: `${DENO_PATH}:${EXTRA_PATHS}:${process.env.PATH}`,
};

async function execYtDlp(args: string[]): Promise<string> {
  const ytDlpPath = getYtDlpPath();
  const proc = Bun.spawn([ytDlpPath, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: ENV_WITH_DENO,
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
// Format selection for streaming (prefers formats with both video+audio to avoid merge)
// Falls back to merge format when single-stream not available
const QUALITY_PRESETS: Record<string, string> = {
  'best': 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
  '1080p': 'best[height<=1080][ext=mp4]/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best',
  '720p': 'best[height<=720][ext=mp4]/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best',
  '480p': 'best[height<=480][ext=mp4]/bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]/best',
  '360p': 'best[height<=360][ext=mp4]/best[height<=360]/best',
  'audio': 'bestaudio[ext=m4a]/bestaudio',
};

// Ensure temp directory exists
fs.ensureDirSync(CONFIG.TEMP_DIR);

// ==================== APP ====================
const app = new Elysia()
  .use(cors())
  .use(swaggerPlugin)

  // API Info
  .get('/', () => {
    return {
      name: 'Video Downloader API',
      version: '1.0.0',
      description: 'API de tai video tu cac nen tang. Backend chi stream, khong luu file.',
      endpoints: {
        'GET /video/info': 'Lay thong tin video',
        'GET /download/stream': 'Stream video truc tiep ve client',
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

  // Get video info
  .get('/video/info', async ({ query }) => {
    try {
      const url = query.url;

      if (!url || !isValidUrl(url)) {
        return { error: 'URL khong hop le' };
      }

      // if (!isSupportedPlatform(url)) {
      //   return { error: 'Nen tang khong duoc ho tro' };
      // }

      console.log(`Getting video info: ${url}`);

      // Handle Threads separately
      if (isThreadsUrl(url)) {
        // First try to extract embedded URL (Instagram, YouTube, etc.) - most common case
        console.log('Checking Threads for embedded media...');
        const embeddedUrl = await extractThreadsEmbeddedUrl(url);
        if (embeddedUrl) {
          // Check if it's a native Threads video
          if (embeddedUrl.startsWith('NATIVE_VIDEO:')) {
            const videoUrl = embeddedUrl.replace('NATIVE_VIDEO:', '');
            console.log(`Found native Threads video`);
            return {
              title: 'Threads Video',
              duration: 'Unknown',
              uploader: 'Threads',
              thumbnail: null,
              source: 'threads_native',
              originalUrl: videoUrl,
            };
          }

          console.log(`Found embedded URL: ${embeddedUrl}`);
          // Get info from embedded URL using yt-dlp
          const output = await execYtDlp([
            '--dump-json',
            '--no-download',
            '--no-warnings',
            embeddedUrl
          ]);
          const info = JSON.parse(output);
          const duration = info.duration
            ? `${Math.floor(info.duration / 60)}:${String(Math.floor(info.duration % 60)).padStart(2, '0')}`
            : 'Unknown';
          return {
            title: info.title || 'Unknown',
            duration,
            uploader: info.uploader || info.channel || 'Unknown',
            thumbnail: info.thumbnail,
            source: 'threads_embedded',
            originalUrl: embeddedUrl,
          };
        }

        // If no embedded URL, try to get direct video from Threads API
        const threadsInfo = await getThreadsVideoInfo(url);
        if (!('error' in threadsInfo)) {
          return threadsInfo;
        }

        return { error: 'Khong tim thay video trong bai dang Threads' };
      }

      // Use yt-dlp for other platforms
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
    query: t.Object({
      url: t.String({ description: 'URL cua video' })
    })
  })

  // Stream download - download to temp file then stream to client
  .get('/download/stream', async ({ query }) => {
    try {
      let url = query.url;
      const quality = query.quality ?? '720p';

      if (!url || !isValidUrl(url)) {
        return new Response(JSON.stringify({ error: 'URL khong hop le' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // if (!isSupportedPlatform(url)) {
      //   return new Response(JSON.stringify({ error: 'Nen tang khong duoc ho tro' }), {
      //     status: 400,
      //     headers: { 'Content-Type': 'application/json' }
      //   });
      // }

      console.log(`Starting download: ${url} (quality: ${quality})`);

      // Handle Threads separately
      if (isThreadsUrl(url)) {
        // First try to extract embedded URL (Instagram, YouTube, etc.) - most common case
        console.log('Checking Threads for embedded media...');
        const embeddedUrl = await extractThreadsEmbeddedUrl(url);
        if (embeddedUrl) {
          // Check if it's a native Threads video
          if (embeddedUrl.startsWith('NATIVE_VIDEO:')) {
            const videoUrl = embeddedUrl.replace('NATIVE_VIDEO:', '');
            console.log(`Downloading native Threads video...`);
            const videoResponse = await axios.get(videoUrl, {
              responseType: 'arraybuffer',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
              timeout: 60000,
            });
            return new Response(videoResponse.data, {
              headers: {
                'Content-Type': 'video/mp4',
                'Content-Disposition': `attachment; filename="threads_video.mp4"`,
                'Content-Length': videoResponse.data.length.toString(),
              }
            });
          }

          console.log(`Found embedded URL: ${embeddedUrl}, using yt-dlp...`);
          // Use the embedded URL instead - let yt-dlp handle it below
          url = embeddedUrl;
        } else {
          // If no embedded URL, try to get direct video from Threads API
          const threadsResult = await getThreadsMedia(url);
          if (threadsResult.success && threadsResult.data) {
            const mediaData = threadsResult.data;
            let videoUrl: string | undefined;

            // Get video URL from result
            if (mediaData.type === 'video' && mediaData.url) {
              videoUrl = mediaData.url;
            } else if (mediaData.type === 'videos' && mediaData.items && mediaData.items.length > 0) {
              videoUrl = mediaData.items[0]!.url;
            } else if (mediaData.type === 'photo' && mediaData.url) {
              // Handle photo - redirect to image URL
              const response = await axios.get(mediaData.url, { responseType: 'arraybuffer' });
              const safeTitle = (mediaData.caption || 'threads_photo').replace(/[^a-zA-Z0-9_\-\s]/g, '_').substring(0, 50);
              return new Response(response.data, {
                headers: {
                  'Content-Type': 'image/jpeg',
                  'Content-Disposition': `attachment; filename="${safeTitle}.jpg"`,
                }
              });
            }

            if (videoUrl) {
              // Download video from Threads
              console.log(`Downloading Threads video: ${videoUrl}`);
              const videoResponse = await axios.get(videoUrl, {
                responseType: 'arraybuffer',
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                }
              });

              const safeTitle = (mediaData.caption || `threads_${mediaData.username}`).replace(/[^a-zA-Z0-9_\-\s]/g, '_').substring(0, 50);
              return new Response(videoResponse.data, {
                headers: {
                  'Content-Type': 'video/mp4',
                  'Content-Disposition': `attachment; filename="${safeTitle}.mp4"`,
                  'Content-Length': videoResponse.data.length.toString(),
                }
              });
            }
          }

          return new Response(JSON.stringify({ error: 'Khong tim thay video trong bai dang Threads' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Use yt-dlp for other platforms
      // Get video info first for filename
      const infoOutput = await execYtDlp([
        '--dump-json',
        '--no-download',
        '--no-warnings',
        url
      ]);
      const info = JSON.parse(infoOutput);

      const formatString: string = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS['720p'] ?? 'best[height<=720]/best';

      const safeTitle = (info.title || 'video').replace(/[^a-zA-Z0-9_\-\s]/g, '_').substring(0, 100);
      const ext = quality === 'audio' ? 'm4a' : 'mp4';
      const downloadFilename = `${safeTitle}.${ext}`;

      // Create unique temp file path
      const tempId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const tempFilePath = path.join(CONFIG.TEMP_DIR, `${tempId}.${ext}`);

      // Download to temp file (allows merging video+audio)
      const ytDlpPath = getYtDlpPath();
      const args: string[] = [
        '-f', formatString,
        '-o', tempFilePath,
        '--no-warnings',
        '--no-playlist',
        '--merge-output-format', ext,
        url
      ];

      console.log(`Downloading to temp file: ${tempFilePath}`);

      const proc = Bun.spawn([ytDlpPath, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: ENV_WITH_DENO,
      });

      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        console.error('yt-dlp error:', stderr);
        // Cleanup temp file if exists
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
        return new Response(JSON.stringify({ error: 'Khong the tai video: ' + stderr.substring(0, 200) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Check if file exists
      if (!fs.existsSync(tempFilePath)) {
        return new Response(JSON.stringify({ error: 'File khong duoc tao' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const fileStats = fs.statSync(tempFilePath);
      console.log(`Download complete: ${tempFilePath} (${fileStats.size} bytes)`);

      const contentType = quality === 'audio' ? 'audio/mp4' : 'video/mp4';

      // Read file and stream to client
      const fileStream = fs.createReadStream(tempFilePath);

      // Delete temp file after stream ends
      fileStream.on('close', () => {
        console.log(`Cleaning up temp file: ${tempFilePath}`);
        fs.unlink(tempFilePath, () => { });
      });

      return new Response(fileStream as any, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${downloadFilename}"`,
          'Content-Length': fileStats.size.toString(),
        }
      });

    } catch (error) {
      console.error('Download error:', error);
      return new Response(JSON.stringify({ error: 'Khong the tai video' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }, {
    detail: {
      tags: ['Download'],
      summary: 'Stream video truc tiep ve client',
      description: 'Stream video tu URL. Backend KHONG luu file, chi pipe truc tiep ve client. Frontend se nhan stream va luu vao may user.',
    },
    query: t.Object({
      url: t.String({ description: 'URL cua video can tai' }),
      quality: t.Optional(t.String({ description: 'Chat luong video: best, 1080p, 720p, 480p, 360p, audio' }))
    })
  })

  .listen(CONFIG.PORT);

console.log(`Video Downloader API is running on http://localhost:${CONFIG.PORT}`);
console.log(`Swagger UI available at http://localhost:${CONFIG.PORT}/swagger`);
