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

// Runtime config (có thể thay đổi qua API)
let runtimeDownloadDir: string | null = null;

// Resolve download directory to absolute path
function getDownloadsDir(): string {
  const dir = runtimeDownloadDir || CONFIG.DOWNLOAD_DIR;
  // Nếu là đường dẫn tương đối, resolve từ thư mục hiện tại
  if (dir.startsWith('./') || dir.startsWith('../') || !path.isAbsolute(dir)) {
    return path.resolve(process.cwd(), dir);
  }
  return dir;
}

// Set download directory
function setDownloadsDir(newDir: string): { success: boolean; path: string; error?: string } {
  try {
    let resolvedPath = newDir;
    if (newDir.startsWith('./') || newDir.startsWith('../') || !path.isAbsolute(newDir)) {
      resolvedPath = path.resolve(process.cwd(), newDir);
    }

    // Tạo thư mục nếu chưa tồn tại
    fs.ensureDirSync(resolvedPath);

    // Kiểm tra quyền ghi
    fs.accessSync(resolvedPath, fs.constants.W_OK);

    runtimeDownloadDir = newDir;
    console.log(`📁 Download directory changed to: ${resolvedPath}`);

    return { success: true, path: resolvedPath };
  } catch (error) {
    return {
      success: false,
      path: newDir,
      error: error instanceof Error ? error.message : 'Khong the truy cap thu muc'
    };
  }
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

// ==================== HTML TEMPLATE ====================
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Video Downloader</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 15px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
    }
    h1 {
      color: #333;
      text-align: center;
      margin-bottom: 30px;
      font-size: 2em;
    }
    .form-group { margin-bottom: 20px; }
    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: #555;
    }
    input[type="url"], input[type="text"], select {
      width: 100%;
      padding: 14px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.3s;
    }
    input[type="url"]:focus, input[type="text"]:focus, select:focus {
      outline: none;
      border-color: #667eea;
    }
    .path-group {
      display: flex;
      gap: 10px;
      align-items: flex-end;
    }
    .path-group .form-group {
      flex: 1;
      margin-bottom: 0;
    }
    .path-group button {
      width: auto;
      padding: 14px 20px;
      white-space: nowrap;
    }
    .current-path {
      font-size: 12px;
      color: #666;
      margin-top: 5px;
      word-break: break-all;
    }
    .path-success {
      color: #28a745;
    }
    .path-error {
      color: #dc3545;
    }
    .options {
      display: flex;
      gap: 15px;
      margin-bottom: 20px;
    }
    .options .form-group {
      flex: 1;
      margin-bottom: 0;
    }
    button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 14px 30px;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
    }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
      transform: none;
    }
    .status {
      margin-top: 20px;
      padding: 15px;
      border-radius: 8px;
      display: none;
    }
    .success {
      background-color: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }
    .error {
      background-color: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }
    .info {
      background-color: #e7f3ff;
      color: #0c5460;
      border: 1px solid #b8daff;
    }
    .progress-container {
      margin-top: 20px;
      display: none;
    }
    .progress-bar {
      width: 100%;
      height: 24px;
      background-color: #e9ecef;
      border-radius: 12px;
      overflow: hidden;
      position: relative;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
      transition: width 0.3s ease;
      border-radius: 12px;
    }
    .progress-text {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-weight: 600;
      font-size: 12px;
      color: #333;
    }
    .progress-details {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 13px;
      color: #666;
    }
    .video-info {
      margin-top: 15px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 8px;
      display: none;
    }
    .video-info h3 {
      margin: 0 0 10px 0;
      color: #333;
    }
    .video-info p {
      margin: 5px 0;
      color: #666;
    }
    .download-link {
      margin-top: 15px;
    }
    .download-link a {
      display: inline-block;
      background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      transition: transform 0.2s;
    }
    .download-link a:hover {
      transform: translateY(-2px);
    }
    .swagger-link {
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      color: #333;
      padding: 10px 20px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
  </style>
</head>
<body>
  <a href="/swagger" class="swagger-link">API Docs</a>
  <div class="container">
    <h1>Video Downloader</h1>
    <form id="downloadForm">
      <div class="form-group">
        <label for="videoUrl">URL Video:</label>
        <input type="url" id="videoUrl" placeholder="https://www.youtube.com/watch?v=..." required>
      </div>
      <div class="options">
        <div class="form-group">
          <label for="quality">Chat luong:</label>
          <select id="quality">
            <option value="best">Cao nhat</option>
            <option value="1080p">1080p</option>
            <option value="720p" selected>720p</option>
            <option value="480p">480p</option>
            <option value="360p">360p</option>
            <option value="audio">Chi audio</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label for="savePath">Thu muc luu file:</label>
        <div class="path-group">
          <div class="form-group">
            <input type="text" id="savePath" placeholder="/home/user/Downloads">
          </div>
          <button type="button" id="setPathBtn" onclick="setDownloadPath()">Thay doi</button>
        </div>
        <div id="currentPath" class="current-path">Dang tai...</div>
      </div>

      <button type="submit" id="downloadBtn">Tai Video</button>
    </form>

    <div id="videoInfo" class="video-info"></div>

    <div id="progressContainer" class="progress-container">
      <div class="progress-bar">
        <div class="progress-fill" id="progressFill"></div>
        <span class="progress-text" id="progressText">0%</span>
      </div>
      <div class="progress-details">
        <span id="speedText">Toc do: --</span>
        <span id="etaText">ETA: --</span>
      </div>
    </div>

    <div id="status" class="status"></div>
  </div>

  <script>
    const form = document.getElementById('downloadForm');
    const statusDiv = document.getElementById('status');
    const downloadBtn = document.getElementById('downloadBtn');
    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const speedText = document.getElementById('speedText');
    const etaText = document.getElementById('etaText');
    const videoInfo = document.getElementById('videoInfo');
    const savePathInput = document.getElementById('savePath');
    const currentPathDiv = document.getElementById('currentPath');

    // Load current config on page load
    async function loadConfig() {
      try {
        const response = await fetch('/config');
        const config = await response.json();
        savePathInput.value = config.downloadDir;
        currentPathDiv.textContent = 'Hien tai: ' + config.downloadDir;
        currentPathDiv.className = 'current-path path-success';
      } catch (e) {
        currentPathDiv.textContent = 'Khong the tai cau hinh';
        currentPathDiv.className = 'current-path path-error';
      }
    }
    loadConfig();

    // Set download path
    async function setDownloadPath() {
      const newPath = savePathInput.value.trim();
      if (!newPath) {
        currentPathDiv.textContent = 'Vui long nhap duong dan';
        currentPathDiv.className = 'current-path path-error';
        return;
      }

      try {
        const response = await fetch('/config/download-dir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: newPath }),
        });
        const result = await response.json();

        if (result.success) {
          currentPathDiv.textContent = 'Da thay doi: ' + result.path;
          currentPathDiv.className = 'current-path path-success';
        } else {
          currentPathDiv.textContent = 'Loi: ' + result.error;
          currentPathDiv.className = 'current-path path-error';
        }
      } catch (e) {
        currentPathDiv.textContent = 'Loi ket noi server';
        currentPathDiv.className = 'current-path path-error';
      }
    }

    function showStatus(message, type) {
      statusDiv.innerHTML = message;
      statusDiv.className = 'status ' + type;
      statusDiv.style.display = 'block';
    }

    function hideStatus() {
      statusDiv.style.display = 'none';
    }

    function setLoading(isLoading) {
      downloadBtn.disabled = isLoading;
      downloadBtn.textContent = isLoading ? 'Dang xu ly...' : 'Tai Video';
    }

    function updateProgress(data) {
      progressFill.style.width = data.progress + '%';
      progressText.textContent = data.progress.toFixed(1) + '%';
      speedText.textContent = 'Toc do: ' + (data.speed || '--');
      etaText.textContent = 'ETA: ' + (data.eta || '--');
    }

    function showVideoInfo(info) {
      videoInfo.innerHTML =
        '<h3>' + info.title + '</h3>' +
        '<p>Thoi luong: ' + info.duration + '</p>' +
        '<p>Kenh: ' + info.uploader + '</p>';
      videoInfo.style.display = 'block';
    }

    async function pollProgress(downloadId) {
      let retries = 0;
      const maxRetries = 300; // 5 minutes max

      while (retries < maxRetries) {
        try {
          const response = await fetch('/download/status/' + downloadId);
          const data = await response.json();

          if (data.error) {
            progressContainer.style.display = 'none';
            showStatus('Loi: ' + data.error, 'error');
            setLoading(false);
            return;
          }

          updateProgress(data);

          if (data.status === 'completed') {
            progressContainer.style.display = 'none';
            showStatus(
              'Tai thanh cong! (' + data.size + ')' +
              '<div class="download-link">' +
              '<a href="' + data.downloadUrl + '" download>Tai file ve may</a>' +
              '</div>',
              'success'
            );
            setLoading(false);
            return;
          } else if (data.status === 'error') {
            progressContainer.style.display = 'none';
            showStatus('Loi: ' + data.message, 'error');
            setLoading(false);
            return;
          }

          await new Promise(r => setTimeout(r, 500));
          retries++;
        } catch (e) {
          console.error('Poll error:', e);
          await new Promise(r => setTimeout(r, 1000));
          retries++;
        }
      }

      showStatus('Qua thoi gian cho', 'error');
      setLoading(false);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const url = document.getElementById('videoUrl').value;
      const quality = document.getElementById('quality').value;

      if (!url) {
        showStatus('Vui long nhap URL video', 'error');
        return;
      }

      setLoading(true);
      hideStatus();
      videoInfo.style.display = 'none';
      progressContainer.style.display = 'none';

      try {
        // Step 1: Get video info
        showStatus('Dang lay thong tin video...', 'info');

        const infoResponse = await fetch('/video/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const info = await infoResponse.json();

        if (info.error) {
          showStatus('Loi: ' + info.error, 'error');
          setLoading(false);
          return;
        }

        showVideoInfo(info);

        // Step 2: Start download
        showStatus('Dang bat dau tai...', 'info');
        progressContainer.style.display = 'block';
        updateProgress({ progress: 0 });

        const response = await fetch('/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, quality }),
        });
        const result = await response.json();

        if (result.error) {
          progressContainer.style.display = 'none';
          showStatus('Loi: ' + result.error, 'error');
          setLoading(false);
          return;
        }

        if (result.downloadId) {
          hideStatus();
          await pollProgress(result.downloadId);
        }

      } catch (error) {
        progressContainer.style.display = 'none';
        showStatus('Loi ket noi: ' + error.message, 'error');
        setLoading(false);
      }
    });
  </script>
</body>
</html>
`;

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

  // Home page
  .get('/', () => {
    return new Response(HTML_TEMPLATE, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }, {
    detail: {
      tags: ['Video'],
      summary: 'Trang chu Video Downloader',
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

  // Get current config
  .get('/config', () => {
    return {
      downloadDir: getDownloadsDir(),
      cleanupMaxAge: CONFIG.CLEANUP_MAX_AGE,
      defaultQuality: CONFIG.DEFAULT_QUALITY,
      port: CONFIG.PORT,
    };
  }, {
    detail: {
      tags: ['Config'],
      summary: 'Xem cau hinh hien tai',
    }
  })

  // Set download directory
  .post('/config/download-dir', async ({ body }) => {
    const { path: newPath } = body;

    if (!newPath) {
      return { success: false, error: 'Vui long nhap duong dan' };
    }

    const result = setDownloadsDir(newPath);
    return result;
  }, {
    detail: {
      tags: ['Config'],
      summary: 'Thay doi thu muc luu file',
      description: 'Thay doi duong dan thu muc luu file tai ve. Co the dung duong dan tuyet doi hoac tuong doi.',
    },
    body: t.Object({
      path: t.String({ description: 'Duong dan thu muc moi' })
    })
  })

  .listen(CONFIG.PORT);

console.log(`🚀 Video Downloader server is running on http://localhost:${CONFIG.PORT}`);
console.log(`📚 Swagger UI available at http://localhost:${CONFIG.PORT}/swagger`);
console.log(`📁 Files will be saved to: ${getDownloadsDir()}`);
