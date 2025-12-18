# Self-Hosted GitHub Actions Runner Setup

## Cách cài đặt nhanh (Khuyến nghị)

### Bước 1: Lấy token từ GitHub

Vào: https://github.com/noblutwo-projects/threadsdownloader/settings/actions/runners/new

Copy token (dạng: `ABCDEFG...`)

### Bước 2: SSH vào server và chạy

```bash
# SSH vào server
ssh your-user@your-server

# Clone repo (nếu chưa có)
cd ~
git clone https://github.com/noblutwo-projects/threadsdownloader.git
cd threadsdownloader

# Chạy script cài đặt
chmod +x install-runner.sh
./install-runner.sh YOUR_TOKEN_HERE
```

### Bước 3: Kiểm tra

Vào: https://github.com/noblutwo-projects/threadsdownloader/settings/actions/runners

Bạn sẽ thấy runner với status **"Idle"** (màu xanh)

### Bước 4: Workflow tự động chạy

Workflow đang queued sẽ tự động chạy ngay khi runner sẵn sàng!

---

## Cài đặt thủ công (Nếu script không hoạt động)

### 1. Tạo runner token trên GitHub

Vào: https://github.com/noblutwo-projects/threadsdownloader/settings/actions/runners/new

### 2. Cài đặt runner trên server

```bash
# Tạo thư mục cho runner
mkdir -p ~/actions-runner && cd ~/actions-runner

# Download runner
curl -o actions-runner-linux-x64-2.321.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz

# Extract
tar xzf ./actions-runner-linux-x64-2.321.0.tar.gz

# Configure runner
./config.sh --url https://github.com/noblutwo-projects/threadsdownloader --token YOUR_TOKEN_HERE --unattended

# Install service
sudo ./svc.sh install

# Start service
sudo ./svc.sh start

# Check status
sudo ./svc.sh status
```

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
