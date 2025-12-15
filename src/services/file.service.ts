import path from 'path';
import fs from 'fs-extra';
import type { FileInfo } from '../types';
import { getDownloadsDir, formatFileSize } from '../utils';

// Clean up old files (older than specified time)
export async function cleanupOldFiles(maxAgeMs: number = 3600000): Promise<void> {
  const downloadsDir = getDownloadsDir();
  try {
    await fs.ensureDir(downloadsDir);
    const files = await fs.readdir(downloadsDir);
    const now = Date.now();

    for (const file of files) {
      const filePath = path.join(downloadsDir, file);
      const stats = await fs.stat(filePath);

      // Delete files older than maxAge
      if (now - stats.mtime.getTime() > maxAgeMs) {
        await fs.remove(filePath);
        console.log(`Cleaned up old file: ${file}`);
      }
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

// List all downloaded files
export async function listFiles(): Promise<FileInfo[]> {
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

  return fileList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Get file by name
export async function getFile(filename: string): Promise<{ file: ReturnType<typeof Bun.file>; stats: fs.Stats } | null> {
  const decodedFilename = decodeURIComponent(filename);
  const filePath = path.join(getDownloadsDir(), decodedFilename);

  if (!(await fs.pathExists(filePath))) {
    return null;
  }

  const file = Bun.file(filePath);
  const stats = await fs.stat(filePath);

  return { file, stats };
}

// Delete file
export async function deleteFile(filename: string): Promise<boolean> {
  const decodedFilename = decodeURIComponent(filename);
  const filePath = path.join(getDownloadsDir(), decodedFilename);

  if (!(await fs.pathExists(filePath))) {
    return false;
  }

  await fs.remove(filePath);
  return true;
}
