// Download progress status
export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'error';

// Download progress tracking
export interface DownloadProgress {
  status: DownloadStatus;
  progress: number;
  message: string;
  filename?: string;
  downloadUrl?: string;
  size?: string;
  title?: string;
  duration?: string;
}

// Video info response
export interface VideoInfo {
  title: string;
  duration: string;
  uploader: string;
  thumbnail?: string;
  viewCount?: number;
  description?: string;
}

// Download request body
export interface DownloadRequest {
  url: string;
  quality?: QualityPreset;
  useAria2c?: boolean;
}

// Download response
export interface DownloadResponse {
  success?: boolean;
  message?: string;
  filename?: string;
  downloadUrl?: string;
  size?: string;
  downloadId?: string;
  error?: string;
}

// File info
export interface FileInfo {
  name: string;
  size: string;
  downloadUrl: string;
  createdAt: Date;
}

// Quality presets
export type QualityPreset = 'best' | '1080p' | '720p' | '480p' | '360p' | 'audio';

// Error response
export interface ErrorResponse {
  error: string;
}
