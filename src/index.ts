import { Elysia, t } from 'elysia';
import path from 'path';
import fs from 'fs-extra';
import { swaggerPlugin } from './plugins';
import { cors } from "@elysiajs/cors";

const CONFIG = {
  PORT: parseInt(process.env.PORT || '3000'),
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
// Add deno to PATH for yt-dlp JavaScript runtime
const DENO_PATH = `${process.env.HOME}/.deno/bin`;
const ENV_WITH_DENO = {
  ...process.env,
  PATH: `${DENO_PATH}:${process.env.PATH}`,
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
    query: t.Object({
      url: t.String({ description: 'URL cua video' })
    })
  })

  // Stream download - stream video directly to client (no file storage on server)
  .get('/download/stream', async ({ query }) => {
    try {
      const url = query.url;
      const quality = query.quality ?? '720p';

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

      const formatString: string = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS['720p'] ?? 'best[height<=720]/best';

      const safeTitle = (info.title || 'video').replace(/[^a-zA-Z0-9_\-\s]/g, '_').substring(0, 100);
      const ext = quality === 'audio' ? 'm4a' : 'mp4';
      const downloadFilename = `${safeTitle}.${ext}`;

      // Stream directly from yt-dlp to client (output to stdout)
      const ytDlpPath = getYtDlpPath();
      const args: string[] = [
        '-f', formatString,
        '-o', '-', // Output to stdout
        '--no-warnings',
        '--no-playlist',
        url
      ];

      const proc = Bun.spawn([ytDlpPath, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: ENV_WITH_DENO,
      });

      // Create a readable stream from yt-dlp stdout
      const stream = proc.stdout;

      const contentType = quality === 'audio' ? 'audio/mp4' : 'video/mp4';

      return new Response(stream, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${downloadFilename}"`,
          'Transfer-Encoding': 'chunked',
        }
      });

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
