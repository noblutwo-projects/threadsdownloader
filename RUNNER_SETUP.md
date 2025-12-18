# Self-Hosted GitHub Actions Runner Setup

## Hướng dẫn cài đặt runner trên server

### 1. Tạo runner token trên GitHub

1. Vào repository: https://github.com/[YOUR_USERNAME]/threadsdownloader
2. Vào **Settings** > **Actions** > **Runners**
3. Click **New self-hosted runner**
4. Chọn **Linux** và **x64**
5. GitHub sẽ hiển thị các lệnh cài đặt

### 2. Cài đặt runner trên server

SSH vào server và chạy các lệnh sau:

```bash
# Tạo thư mục cho runner
mkdir -p ~/actions-runner && cd ~/actions-runner

# Download runner (check GitHub for latest version)
curl -o actions-runner-linux-x64-2.321.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz

# Extract
tar xzf ./actions-runner-linux-x64-2.321.0.tar.gz

# Configure runner
./config.sh --url https://github.com/[YOUR_USERNAME]/threadsdownloader --token [TOKEN_FROM_GITHUB]

# Nhập tên runner (Enter để dùng default)
# Nhập labels (Enter để dùng default: self-hosted,Linux,X64)
# Nhập work folder (Enter để dùng default: _work)
```

### 3. Chạy runner như service (khuyến nghị)

```bash
# Install service
sudo ./svc.sh install

# Start service
sudo ./svc.sh start

# Check status
sudo ./svc.sh status
```

### 4. Kiểm tra runner

Vào **Settings** > **Actions** > **Runners** trên GitHub, bạn sẽ thấy runner với status "Idle" (màu xanh).

### 5. Test deployment

Push code hoặc trigger workflow manually:
- Vào tab **Actions** trên GitHub
- Chọn workflow "Deploy to Production"
- Click **Run workflow**

## Quản lý runner

```bash
# Stop service
sudo ./svc.sh stop

# Uninstall service
sudo ./svc.sh uninstall

# Remove runner
./config.sh remove --token [NEW_TOKEN_FROM_GITHUB]
```

## Lưu ý

- Runner sẽ tự động chạy khi server khởi động
- Không cần SSH keys, Cloudflare Tunnel hay bất kỳ cấu hình phức tạp nào
- Runner chạy với user hiện tại, đảm bảo user có quyền truy cập ~/threadsdownloader
- Nếu cần update code logic deploy, chỉ cần sửa file `.github/workflows/deploy.yml`
