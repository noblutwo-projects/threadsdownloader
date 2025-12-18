import { useState } from 'react';
import './index.css';

const API_BASE = 'https://test3.ducbinh203.site';

interface VideoInfo {
  title: string;
  duration: string;
  uploader: string;
  thumbnail: string;
  error?: string;
}

// Add support for File System Access API
declare global {
  interface Window {
    showSaveFilePicker?: (options?: any) => Promise<any>;
    showDirectoryPicker?: (options?: any) => Promise<any>;
  }
}

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState<number | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState('720p');
  const [saveDirHandle, setSaveDirHandle] = useState<any>(null);
  const [saveDirName, setSaveDirName] = useState<string>('');

  const supportedQualities = ['best', '1080p', '720p', '480p', '360p', 'audio'];

  const handleSelectFolder = async () => {
    if (!window.showDirectoryPicker) {
      alert('Your browser does not support folder selection.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker();
      setSaveDirHandle(handle);
      setSaveDirName(handle.name);
    } catch (err) {
      console.error('Folder selection cancelled or failed:', err);
    }
  };

  const handleGetInfo = async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const response = await fetch(`${API_BASE}/video/info?url=${encodeURIComponent(url)}`);
      const data = await response.json();

      if (data.error) {
        setError(data.error);
      } else {
        setInfo(data);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to connect to server. Make sure the backend is running or reachable.');
    } finally {
      setLoading(false);
    }
  };



  const handleDownload = async () => {
    if (!url || !info) return;

    // Build URL
    const downloadUrl = `${API_BASE}/download/stream?url=${encodeURIComponent(url)}&quality=${quality}`;

    // 1. Check if File System Access API is supported (Chrome, Edge, etc.)
    if (window.showSaveFilePicker) {
      try {
        const ext = quality === 'audio' ? 'm4a' : 'mp4';
        const safeTitle = (info.title || 'video')
          .replace(/[^a-zA-Z0-9_\-\s]/g, '')
          .trim()
          .substring(0, 100);

        const suggestedName = `${safeTitle}.${ext}`;

        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{
            description: quality === 'audio' ? 'Audio File' : 'Video File',
            accept: {
              [quality === 'audio' ? 'audio/mp4' : 'video/mp4']: [`.${ext}`]
            },
          }],
        });

        const writable = await handle.createWritable();

        setDownloading(true);
        setDownloadProgress(0);
        setDownloadTotal(null); // Chunked often has no content-length

        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error('Download failed');
        if (!response.body) throw new Error('No readable stream');

        // Check content-length if available
        const contentLength = response.headers.get('Content-Length');
        if (contentLength) {
          setDownloadTotal(parseInt(contentLength, 10));
        }

        // Create a transform stream to count bytes
        const progressStream = new TransformStream({
          transform(chunk, controller) {
            setDownloadProgress(prev => prev + chunk.byteLength);
            controller.enqueue(chunk);
          }
        });

        // Pipe: Fetch Body -> Progress Counter -> File System
        await response.body.pipeThrough(progressStream).pipeTo(writable);

        alert('Download completed successfully!');
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // User cancelled the picker, do nothing
          return;
        }
        console.error('Download error:', err);
        setError('An error occurred while downloading. Please try again.');
        // Fallback to legacy method if file write fails but wasn't cancelled?
        // Usually better to just show error.
      } finally {
        setDownloading(false);
        setDownloadProgress(0);
      }
    } else if (saveDirHandle) {
      window.location.href = downloadUrl;
    } else {
      // 2. Fallback for Firefox / Unsupported Browsers
      window.location.href = downloadUrl;
    }
  };

  return (
    <div className="container">
      <header>
        <h1>FlashDown</h1>
        <p className="subtitle">Universal Video Downloader</p>

        {/* Folder Selection UI */}
        {window.showDirectoryPicker && (
          <div className="folder-select-container">
            <button className="secondary-btn" onClick={handleSelectFolder}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              {saveDirName ? `Saving to: ${saveDirName}` : 'Select Save Folder'}
            </button>
            {saveDirName && (
              <button className="icon-btn-small" onClick={() => { setSaveDirHandle(null); setSaveDirName(''); }} title="Clear Selection">
                ✕
              </button>
            )}
          </div>
        )}
      </header>

      <div className="input-group">
        <input
          type="text"
          placeholder="Paste video URL here (YouTube, Facebook, TikTok...)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleGetInfo()}
        />
        <button
          className="primary"
          onClick={handleGetInfo}
          disabled={loading || !url}
        >
          {loading ? <span className="loading-dots">Processing</span> : 'Get Info'}
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {info && (
        <div className="video-card">
          <div className="card-body">
            <div className="video-info">
              <div className="thumbnail-wrapper">
                <img src={info.thumbnail} alt={info.title} className="thumbnail" />
                <div className="duration-badge">{info.duration}</div>
              </div>
              <div className="details">
                <h3>{info.title}</h3>
                <div className="meta">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                  <span>{info.uploader}</span>
                </div>
              </div>
            </div>

            <div className="controls">
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
              >
                {supportedQualities.map(q => (
                  <option key={q} value={q}>
                    {q === 'audio' ? 'Audio Only (m4a)' : q.toUpperCase()}
                  </option>
                ))}
              </select>

              <button className="download-btn" onClick={handleDownload}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                {downloading ? 'Downloading...' : `Download ${quality === 'audio' ? 'Audio' : 'Video'}`}
              </button>
            </div>

            {downloading && (
              <div className="progress-container">
                <div className="progress-text">
                  <span>Downloaded: {formatBytes(downloadProgress)}</span>
                  {downloadTotal && <span> / {formatBytes(downloadTotal)}</span>}
                </div>
                {downloadTotal ? (
                  <progress value={downloadProgress} max={downloadTotal}></progress>
                ) : (
                  <div className="progress-bar-indeterminate">
                    <div className="progress-bar-fill"></div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
