import path from 'path';
import fs from 'fs-extra';
import type { DownloadProgress, VideoInfo, QualityPreset } from '../types';
import {
  getYtDlpPath,
  hasAria2c,
  generateDownloadId,
  formatDuration,
  formatFileSize,
  getDownloadsDir,
  QUALITY_PRESETS,
} from '../utils';

// Store download progress in memory
const downloadProgress: Map<string, DownloadProgress> = new Map();

// Execute yt-dlp command
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

// Execute yt-dlp with progress tracking
async function execYtDlpWithProgress(args: string[], downloadId: string): Promise<string> {
  const ytDlpPath = getYtDlpPath();
  const proc = Bun.spawn([ytDlpPath, '--newline', '--progress', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let lastFilename = '';
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n');

      for (const line of lines) {
        // Parse progress from yt-dlp output
        const progressMatch = line.match(/(\d+\.?\d*)%/);
        if (progressMatch && progressMatch[1]) {
          const progress = parseFloat(progressMatch[1]);
          const currentProgress = downloadProgress.get(downloadId);
          if (currentProgress) {
            currentProgress.progress = progress;
            currentProgress.message = `Đang tải: ${progress.toFixed(1)}%`;
          }
        }

        // Parse filename
        const filenameMatch = line.match(/\[download\] Destination: (.+)/);
        if (filenameMatch && filenameMatch[1]) {
          lastFilename = filenameMatch[1];
        }

        // Already downloaded
        const alreadyMatch = line.match(/\[download\] (.+) has already been downloaded/);
        if (alreadyMatch && alreadyMatch[1]) {
          lastFilename = alreadyMatch[1];
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

  return lastFilename;
}

// Get video info without downloading
export async function getVideoInfo(url: string): Promise<VideoInfo> {
  console.log(`Getting video info: ${url}`);

  const output = await execYtDlp([
    '--dump-json',
    '--no-download',
    '--no-warnings',
    url
  ]);

  const info = JSON.parse(output);

  return {
    title: info.title || 'Unknown',
    duration: formatDuration(info.duration),
    uploader: info.uploader || info.channel || 'Unknown',
    thumbnail: info.thumbnail,
    viewCount: info.view_count,
    description: info.description?.substring(0, 200),
  };
}

// Start video download
export async function startDownload(
  url: string,
  quality: QualityPreset = '720p',
  useAria2c: boolean = true
): Promise<string> {
  const downloadsDir = getDownloadsDir();
  await fs.ensureDir(downloadsDir);

  const downloadId = generateDownloadId();

  // Get format string based on quality
  const formatString: string = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS['720p'] ?? 'best[height<=720]/best';

  // Check if aria2c is available
  const aria2cAvailable = useAria2c && await hasAria2c();

  // Initialize progress
  downloadProgress.set(downloadId, {
    status: 'downloading',
    progress: 0,
    message: aria2cAvailable ? 'Bắt đầu tải (aria2c)...' : 'Bắt đầu tải...',
  });

  console.log(`Starting download [${downloadId}]: ${url} (quality: ${quality}, aria2c: ${aria2cAvailable})`);

  // Start download in background
  (async () => {
    try {
      // Build arguments
      const args: string[] = [
        // Format selection
        '-f', formatString,

        // Output
        '-o', path.join(downloadsDir, '%(title)s.%(ext)s'),
        '--restrict-filenames',

        // Speed optimizations
        '--concurrent-fragments', '8',
        '--buffer-size', '32K',
        '--http-chunk-size', '10M',

        // Network optimizations
        '--socket-timeout', '30',
        '--retries', '5',
        '--fragment-retries', '5',

        // Skip unnecessary processing
        '--no-warnings',
        '--no-playlist',
        '--no-write-thumbnail',
        '--no-write-description',
        '--no-write-info-json',
        '--no-write-comments',
        '--no-mtime',
      ];

      // Add aria2c if available (much faster!)
      if (aria2cAvailable) {
        args.push(
          '--external-downloader', 'aria2c',
          '--external-downloader-args', 'aria2c:-x 16 -s 16 -k 1M -j 16'
        );
      }

      args.push(url);

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
          message: 'Tải thành công!',
          filename: latestFile.name,
          downloadUrl: `/download-file/${encodeURIComponent(latestFile.name)}`,
          size: formatFileSize(stats.size),
        });
      } else {
        throw new Error('Không tìm thấy file đã tải');
      }
    } catch (error) {
      console.error('Download error:', error);
      downloadProgress.set(downloadId, {
        status: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : 'Lỗi không xác định',
      });
    }
  })();

  return downloadId;
}

// Get download progress
export function getDownloadProgress(downloadId: string): DownloadProgress | null {
  return downloadProgress.get(downloadId) || null;
}

// Clean up old progress entries (optional)
export function cleanupOldProgress(maxAge: number = 3600000): void {
  // Implementation for cleaning up old progress entries if needed
}
