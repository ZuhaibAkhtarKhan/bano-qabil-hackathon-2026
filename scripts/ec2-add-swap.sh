#!/usr/bin/env bash
# Adds 4GB swap so Next.js build can finish on t4g.small / t3.micro.
set -euo pipefail

if swapon --show | grep -q '/swapfile'; then
  echo "Swap already enabled:"
  swapon --show
  free -h
  exit 0
fi

echo "Creating 4GB swap file (one-time setup)..."
sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

echo "Swap enabled:"
swapon --show
free -h
