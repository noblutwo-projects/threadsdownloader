import { swagger } from '@elysiajs/swagger';

export const swaggerPlugin = swagger({
  path: '/swagger',
  provider: 'swagger-ui',
  documentation: {
    info: {
      title: 'Video Downloader API',
      description: 'API để tải video từ nhiều nền tảng khác nhau (YouTube, Facebook, TikTok, Instagram...)',
      version: '1.0.0',
    },
    tags: [
      {
        name: 'Video',
        description: 'Endpoints liên quan đến thông tin video',
      },
      {
        name: 'Download',
        description: 'Endpoints liên quan đến việc tải video',
      },
      {
        name: 'Files',
        description: 'Endpoints quản lý file đã tải',
      },
    ],
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
  },
});
