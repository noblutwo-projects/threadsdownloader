import { Elysia } from 'elysia';

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
      background-color: #f5f5f5;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      text-align: center;
      margin-bottom: 30px;
    }
    .form-group { margin-bottom: 20px; }
    label {
      display: block;
      margin-bottom: 5px;
      font-weight: bold;
      color: #555;
    }
    input[type="url"], select {
      width: 100%;
      padding: 12px;
      border: 2px solid #ddd;
      border-radius: 5px;
      font-size: 16px;
    }
    input[type="url"]:focus, select:focus {
      outline: none;
      border-color: #007bff;
    }
    button {
      background-color: #007bff;
      color: white;
      padding: 12px 30px;
      border: none;
      border-radius: 5px;
      font-size: 16px;
      cursor: pointer;
      width: 100%;
      transition: background-color 0.3s;
    }
    button:hover { background-color: #0056b3; }
    button:disabled {
      background-color: #ccc;
      cursor: not-allowed;
    }
    .status {
      margin-top: 20px;
      padding: 15px;
      border-radius: 5px;
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
      background-color: #d1ecf1;
      color: #0c5460;
      border: 1px solid #bee5eb;
    }
    .progress-bar {
      width: 100%;
      height: 20px;
      background-color: #e9ecef;
      border-radius: 10px;
      margin-top: 10px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background-color: #007bff;
      transition: width 0.3s ease;
      border-radius: 10px;
    }
    .video-info {
      margin-top: 15px;
      padding: 10px;
      background: #f8f9fa;
      border-radius: 5px;
    }
    .video-info p { margin: 5px 0; }
    .download-link { margin-top: 10px; }
    .download-link a {
      color: #007bff;
      text-decoration: none;
      font-weight: bold;
    }
    .download-link a:hover { text-decoration: underline; }
    .swagger-link {
      position: fixed;
      top: 20px;
      right: 20px;
      background-color: #85ea2d;
      color: #000;
      padding: 8px 16px;
      border-radius: 5px;
      text-decoration: none;
      font-weight: bold;
      font-size: 14px;
    }
    .swagger-link:hover { background-color: #7dd313; }
    .options { display: flex; gap: 10px; margin-bottom: 20px; }
    .options .form-group { flex: 1; margin-bottom: 0; }
  </style>
</head>
<body>
  <a href="/swagger" class="swagger-link">API Docs</a>
  <div class="container">
    <h1>Video Downloader</h1>
    <form id="downloadForm">
      <div class="form-group">
        <label for="videoUrl">URL video:</label>
        <input type="url" id="videoUrl" placeholder="https://www.youtube.com/watch?v=..." required>
      </div>
      <div class="options">
        <div class="form-group">
          <label for="quality">Chat luong:</label>
          <select id="quality">
            <option value="best">Best</option>
            <option value="1080p">1080p</option>
            <option value="720p" selected>720p</option>
            <option value="480p">480p</option>
            <option value="360p">360p</option>
            <option value="audio">Audio only</option>
          </select>
        </div>
      </div>
      <button type="submit" id="downloadBtn">Tai Video</button>
    </form>

    <div id="status" class="status"></div>
    <div id="progressContainer" style="display:none;">
      <div class="progress-bar">
        <div class="progress-fill" id="progressFill" style="width: 0%"></div>
      </div>
      <p id="progressText" style="text-align: center; margin-top: 5px;">0%</p>
    </div>
    <div id="videoInfo" class="video-info" style="display:none;"></div>
  </div>

  <script>
    const form = document.getElementById('downloadForm');
    const statusDiv = document.getElementById('status');
    const downloadBtn = document.getElementById('downloadBtn');
    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const videoInfo = document.getElementById('videoInfo');

    function showStatus(message, type) {
      statusDiv.innerHTML = message;
      statusDiv.className = 'status ' + type;
      statusDiv.style.display = 'block';
    }

    function setLoading(isLoading) {
      downloadBtn.disabled = isLoading;
      downloadBtn.textContent = isLoading ? 'Dang xu ly...' : 'Tai Video';
    }

    function updateProgress(percent) {
      progressFill.style.width = percent + '%';
      progressText.textContent = percent.toFixed(1) + '%';
    }

    async function pollProgress(downloadId) {
      while (true) {
        try {
          const response = await fetch('/download/status/' + downloadId);
          const data = await response.json();

          updateProgress(data.progress || 0);

          if (data.status === 'completed') {
            progressContainer.style.display = 'none';
            showStatus(
              'Tai video thanh cong!<br>' +
              '<div class="download-link"><a href="' + data.downloadUrl + '" download>Nhan vao day de tai file (' + data.size + ')</a></div>',
              'success'
            );
            setLoading(false);
            break;
          } else if (data.status === 'error') {
            progressContainer.style.display = 'none';
            showStatus('Loi: ' + data.message, 'error');
            setLoading(false);
            break;
          }

          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error('Poll error:', e);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
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
      videoInfo.style.display = 'none';
      progressContainer.style.display = 'none';
      showStatus('Dang lay thong tin video...', 'info');

      try {
        // Get video info first
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

        // Show video info
        videoInfo.innerHTML = '<p><strong>' + info.title + '</strong></p>' +
          '<p>Thoi luong: ' + info.duration + '</p>' +
          '<p>Kenh: ' + (info.uploader || 'Unknown') + '</p>';
        videoInfo.style.display = 'block';

        showStatus('Dang tai video...', 'info');
        progressContainer.style.display = 'block';
        updateProgress(0);

        // Start download
        const response = await fetch('/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, quality }),
        });

        const result = await response.json();

        if (result.downloadId) {
          pollProgress(result.downloadId);
        } else if (result.error) {
          progressContainer.style.display = 'none';
          showStatus('Loi: ' + result.error, 'error');
          setLoading(false);
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

export const homeRoutes = new Elysia()
  .get('/', () => {
    return new Response(HTML_TEMPLATE, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }, {
    detail: {
      tags: ['Video'],
      summary: 'Trang chủ Video Downloader',
      description: 'Trả về giao diện web để người dùng có thể tải video',
    }
  });
