#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(uname -s)" != "Linux" ]] || ! grep -qiE "(microsoft|wsl)" /proc/sys/kernel/osrelease /proc/version 2>/dev/null; then
  echo "This installer must be run inside WSL." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "The automatic WSL setup currently supports Ubuntu and Debian distributions." >&2
  exit 1
fi

if [[ "$ROOT_DIR" == /mnt/* ]]; then
  echo "Warning: the project is under $ROOT_DIR."
  echo "For faster installs and file watching, keep it in the WSL filesystem (for example, \$HOME/DiscStream)."
  echo
fi

echo "Installing DiscStream system dependencies..."
sudo apt-get update
sudo apt-get install -y \
  ca-certificates \
  curl \
  eject \
  ffmpeg \
  lsof \
  unzip \
  util-linux \
  udev

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js 20 or newer is required inside WSL."
  echo "Install it with your preferred Linux Node.js manager, then run this script again." >&2
  exit 1
fi

NODE_PATH="$(command -v node)"
if [[ "$NODE_PATH" == /mnt/* ]]; then
  echo "The detected Node.js executable belongs to Windows: $NODE_PATH" >&2
  echo "Install Node.js inside WSL and ensure its Linux executable comes first in PATH." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js 20 or newer is required; found $(node --version)." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@9.15.0 --activate
  else
    echo "pnpm is required. Install pnpm 9 inside WSL, then run this script again." >&2
    exit 1
  fi
fi

cd "$ROOT_DIR"
./scripts/install.sh

echo
echo "WSL setup is complete."
echo "Start DiscStream with: pnpm dev"
echo "Then open http://localhost:5173 in Windows."
