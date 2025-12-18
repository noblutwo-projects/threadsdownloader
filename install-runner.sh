#!/bin/bash
set -e

echo "=========================================="
echo "GitHub Actions Self-Hosted Runner Setup"
echo "=========================================="
echo ""

# Check if token is provided
if [ -z "$1" ]; then
    echo "ERROR: Runner token is required!"
    echo ""
    echo "Usage: ./install-runner.sh YOUR_TOKEN_HERE"
    echo ""
    echo "Get your token from:"
    echo "https://github.com/noblutwo-projects/threadsdownloader/settings/actions/runners/new"
    echo ""
    exit 1
fi

RUNNER_TOKEN=$1
RUNNER_VERSION="2.321.0"
REPO_URL="https://github.com/noblutwo-projects/threadsdownloader"

echo "Step 1: Creating runner directory..."
mkdir -p ~/actions-runner
cd ~/actions-runner

echo ""
echo "Step 2: Downloading runner (version $RUNNER_VERSION)..."
if [ ! -f "actions-runner-linux-x64-$RUNNER_VERSION.tar.gz" ]; then
    curl -o actions-runner-linux-x64-$RUNNER_VERSION.tar.gz -L \
        https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/actions-runner-linux-x64-$RUNNER_VERSION.tar.gz
    echo "Downloaded successfully!"
else
    echo "Archive already exists, skipping download..."
fi

echo ""
echo "Step 3: Extracting runner..."
tar xzf ./actions-runner-linux-x64-$RUNNER_VERSION.tar.gz

echo ""
echo "Step 4: Configuring runner..."
./config.sh --url $REPO_URL --token $RUNNER_TOKEN --unattended --replace

echo ""
echo "Step 5: Installing runner as service..."
sudo ./svc.sh install

echo ""
echo "Step 6: Starting runner service..."
sudo ./svc.sh start

echo ""
echo "Step 7: Checking runner status..."
sudo ./svc.sh status

echo ""
echo "=========================================="
echo "✓ Runner installation completed!"
echo "=========================================="
echo ""
echo "Check runner status on GitHub:"
echo "https://github.com/noblutwo-projects/threadsdownloader/settings/actions/runners"
echo ""
echo "Your workflow will start automatically!"
echo ""
