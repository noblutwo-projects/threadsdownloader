import { Elysia } from 'elysia';
import { listFiles, getFile, deleteFile } from '../services';

export const fileRoutes = new Elysia({ prefix: '' })
  // Download file
  .get('/download-file/:filename',
    async ({ params }) => {
      try {
        const { filename } = params;
        const result = await getFile(filename);

        if (!result) {
          return new Response('File not found', { status: 404 });
        }

        const { file, stats } = result;
        const decodedFilename = decodeURIComponent(filename);

        return new Response(file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'Content-Length': stats.size.toString(),
            'Content-Disposition': `attachment; filename="${decodedFilename}"`,
          }
        });
      } catch (error) {
        console.error('File download error:', error);
        return new Response('Internal server error', { status: 500 });
      }
    }, {
      detail: {
        tags: ['Files'],
        summary: 'Tải file video đã xử lý',
        description: 'Trả về file video đã được tải xuống',
      }
    })

  // List downloaded files
  .get('/files',
    async () => {
      try {
        const files = await listFiles();
        return files;
      } catch (error) {
        return { error: 'Không thể lấy danh sách file' };
      }
    }, {
      detail: {
        tags: ['Files'],
        summary: 'Danh sách file đã tải',
        description: 'Lấy danh sách các file video đã tải về',
      }
    })

  // Delete file
  .delete('/files/:filename',
    async ({ params }) => {
      try {
        const { filename } = params;
        const deleted = await deleteFile(filename);

        if (!deleted) {
          return { error: 'File không tồn tại' };
        }

        return { success: true, message: 'File đã được xóa' };
      } catch (error) {
        console.error('Delete file error:', error);
        return { error: 'Không thể xóa file' };
      }
    }, {
      detail: {
        tags: ['Files'],
        summary: 'Xóa file',
        description: 'Xóa file video đã tải',
      }
    });
