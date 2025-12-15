import { Elysia, t } from 'elysia';
import { getVideoInfo, startDownload, getDownloadProgress } from '../services';
import { cleanupOldFiles } from '../services';
import { isValidUrl, isSupportedPlatform, SUPPORTED_PLATFORMS } from '../utils';

export const downloadRoutes = new Elysia({ prefix: '' })
  // Get video info
  .post('/video/info',
    async ({ body }) => {
      try {
        const { url } = body;
        if (!url) {
          return { error: 'Vui lòng cung cấp URL video' };
        }
        if (!isValidUrl(url)) {
          return { error: 'URL không hợp lệ' };
        }
        if (!isSupportedPlatform(url)) {
          return { error: 'Nền tảng không được hỗ trợ' };
        }
        const info = await getVideoInfo(url);
        return info;
      } catch (error) {
        console.error('Get info error:', error);
        return { error: 'Không thể lấy thông tin video. ' + (error instanceof Error ? error.message : '') };
      }
    }, {
    detail: {
      tags: ['Video'],
      summary: 'Lấy thông tin video',
      description: 'Lấy thông tin video từ URL mà không tải về',
    },
    body: t.Object({
      url: t.String({ description: 'URL của video' })
    })
  })

  // Start download
  .post('/download',
    async ({ body }) => {
      try {
        const { url, quality, useAria2c } = body;
        const selectedQuality = quality ?? '720p';
        const enableAria2c = useAria2c ?? true;

        if (!url) {
          return { error: 'Vui lòng cung cấp URL video' };
        }

        if (!isValidUrl(url)) {
          return { error: 'URL không hợp lệ' };
        }

        if (!isSupportedPlatform(url)) {
          return {
            error: 'Nền tảng không được hỗ trợ. Các nền tảng được hỗ trợ: ' +
              SUPPORTED_PLATFORMS.join(', ')
          };
        }

        // Clean up old files before starting new download
        await cleanupOldFiles();

        const downloadId = await startDownload(url, selectedQuality, enableAria2c);

        return { downloadId, message: 'Đang tải video...' };
      } catch (error) {
        console.error('Download error:', error);
        return { error: 'Không thể tải video' };
      }
    }, {
    detail: {
      tags: ['Download'],
      summary: 'Tải video từ URL',
      description: 'Bắt đầu tải video và trả về downloadId để theo dõi tiến trình. Hỗ trợ chọn chất lượng và sử dụng aria2c để tải nhanh hơn.',
    },
    body: t.Object({
      url: t.String({ description: 'URL của video cần tải' }),
      quality: t.Optional(t.Union([
        t.Literal('best'),
        t.Literal('1080p'),
        t.Literal('720p'),
        t.Literal('480p'),
        t.Literal('360p'),
        t.Literal('audio'),
      ], { default: '720p', description: 'Chất lượng video' })),
      useAria2c: t.Optional(t.Boolean({ default: true, description: 'Sử dụng aria2c để tải nhanh hơn' })),
    })
  })

  // Get download status
  .get('/download/status/:downloadId',
    ({ params }) => {
      const { downloadId } = params;
      const progress = getDownloadProgress(downloadId);

      if (!progress) {
        return { error: 'Download ID không tồn tại' };
      }

      return progress;
    }, {
    detail: {
      tags: ['Download'],
      summary: 'Kiểm tra trạng thái tải',
      description: 'Lấy trạng thái và tiến trình tải video',
    }
  });
