# Video Downloader Backend

Một backend mạnh mẽ để tải video từ nhiều nền tảng khác nhau sử dụng Node.js, TypeScript, và yt-dlp.

## 🚀 Tính năng

- ✅ Tải video từ nhiều nền tảng (YouTube, Facebook, Instagram, TikTok, Twitter, Vimeo, Dailymotion)
- ✅ Giao diện web thân thiện với người dùng
- ✅ Validation URL và kiểm tra nền tảng hỗ trợ
- ✅ Quality control (tối đa 720p để tiết kiệm băng thông)
- ✅ Auto cleanup (xóa file cũ sau 1 giờ)
- ✅ Error handling chi tiết
- ✅ Metadata extraction
- ✅ File size display
- ✅ Responsive design

## 📋 Yêu cầu

- Node.js (v18+)
- Bun (v1.2.17+)
- yt-dlp (tự động cài đặt với snap)

## 🛠️ Cài đặt

1. Clone repository:
```bash
git clone <repository-url>
cd video-downloader-backend
```

2. Cài đặt dependencies:
```bash
bun install
```

3. Cài đặt yt-dlp (nếu chưa có):
```bash
sudo snap install yt-dlp
```

## 🏃‍♂️ Chạy ứng dụng

```bash
bun run index.ts
```

Server sẽ chạy tại http://localhost:3000

### 🔗 URLs quan trọng:
- **Giao diện web**: http://localhost:3000
- **Swagger Documentation**: http://localhost:3000/swagger
- **Static files**: http://localhost:3000/downloads

## 🌐 API Endpoints

### GET `/`
Trả về giao diện web để tải video.

### POST `/download`
Tải video từ URL cung cấp.

**Request Body:**
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Video đã được tải thành công!",
  "filename": "video_title.mp4",
  "downloadUrl": "/download-file/video_title.mp4",
  "size": "15.23 MB"
}
```

### GET `/download-file/:filename`
Tải file video đã được xử lý.

## 🎯 Nền tảng được hỗ trợ

- YouTube (youtube.com, youtu.be)
- Facebook (facebook.com, fb.watch)
- Instagram (instagram.com)
- TikTok (tiktok.com)
- Twitter/X (twitter.com, x.com)
- Vimeo (vimeo.com)
- Dailymotion (dailymotion.com)

## 📁 Cấu trúc thư mục

```
video-downloader-backend/
├── src/
│   └── index.ts          # Main application file
├── downloads/             # Thư mục lưu video đã tải
├── package.json          # Dependencies và scripts
├── tsconfig.json         # TypeScript configuration
├── bun.lock              # Bun lock file
└── README.md             # Documentation
```

## ⚙️ Cấu hình

- **Port:** 3000 (có thể thay đổi trong code)
- **Quality:** Tối đa 720p (để tiết kiệm băng thông)
- **Cleanup:** Files cũ hơn 1 giờ sẽ tự động bị xóa
- **Output format:** Tự động phát hiện format tốt nhất

## 🔧 Development

### Dependencies chính:
- `elysia` - Web framework nhanh và hiện đại
- `yt-dlp-exec` - Node.js wrapper cho yt-dlp
- `fs-extra` - Enhanced file system operations
- `typescript` - Type safety

### Script commands:
```bash
bun run index.ts    # Chạy server
bun install         # Cài đặt dependencies
```

## 🛡️ Security considerations

- Input validation cho tất cả URLs
- Platform whitelist để tránh abuse
- Auto cleanup để tránh đầy disk
- Error handling để không lộ thông tin nhạy cảm
- File access control

## 📝 Todo / Improvements

- [ ] Add authentication system
- [ ] Implement rate limiting
- [ ] Add download progress tracking
- [ ] Support for audio-only downloads
- [ ] Add video quality selection
- [ ] Implement queue system for large downloads
- [ ] Add database for download history
- [ ] Support for playlist downloads

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## ⚠️ Disclaimer

Sử dụng ứng dụng này để tải video có thể vi phạm terms of service của các nền tảng. Vui lòng sử dụng có trách nhiệm và chỉ tải nội dung mà bạn có quyền tải.

## 🆘 Troubleshooting

### Common issues:

1. **yt-dlp not found:**
   ```bash
   sudo snap install yt-dlp
   ```

2. **Permission denied:**
   ```bash
   sudo chown -R $USER:$USER downloads/
   ```

3. **Port already in use:**
   - Thay đổi port trong code hoặc kill process đang sử dụng port 3000

4. **Video download failed:**
   - Kiểm tra URL có hợp lệ không
   - Đảm bảo video không phải private hoặc bị xóa
   - Kiểm tra kết nối internet

This project was created using `bun init` in bun v1.2.17. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
