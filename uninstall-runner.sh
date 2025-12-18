#!/bin/bash
set -e

echo "=========================================="
echo "Uninstalling GitHub Actions Runner"
echo "=========================================="
echo ""

cd ~/actions-runner

echo "Step 1: Stopping runner service..."
sudo ./svc.sh stop || true

echo ""
echo "Step 2: Uninstalling service..."
sudo ./svc.sh uninstall || true

echo ""
echo "Step 3: Removing runner configuration..."
if [ -z "$1" ]; then
    echo "WARNING: No token provided, skipping runner removal from GitHub"
    echo "Usage: ./uninstall-runner.sh YOUR_REMOVAL_TOKEN"
    echo ""
    echo "Get your token from:"
    echo "https://github.com/noblutwo-projects/threadsdownloader/settings/actions/runners"
else
    ./config.sh remove --token $1
fi

echo ""
echo "=========================================="
echo "✓ Runner uninstalled!"
echo "=========================================="
echo ""
