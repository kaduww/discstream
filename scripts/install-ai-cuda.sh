#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${DISCSTREAM_RUNTIME_DIR:-$ROOT_DIR/runtime}"
CUDA_ROOT="$RUNTIME_DIR/data/ai/cuda"
SOURCE_DIR="$CUDA_ROOT/Real-ESRGAN"
VENV_DIR="$CUDA_ROOT/venv"
ARCHIVE_URL="https://github.com/xinntao/Real-ESRGAN/archive/refs/tags/v0.3.0.tar.gz"
ARCHIVE_SHA256="4fbaa9470fc2e2bffa2f6b0e9b7304b3102d7b4d0c4b9dc3a7ff3d237499fed1"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "The CUDA backend is supported on Linux with NVIDIA GPUs." >&2
  exit 1
fi
for command_name in python3 curl tar nvidia-smi; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required for the CUDA backend." >&2
    exit 1
  fi
done
if command -v shasum >/dev/null 2>&1; then
  hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }
elif command -v sha256sum >/dev/null 2>&1; then
  hash_file() { sha256sum "$1" | awk '{print $1}'; }
else
  echo "shasum or sha256sum is required to verify the CUDA source package." >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/discstream-cuda.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT
curl -fL --retry 2 -o "$TEMP_DIR/realesrgan.tar.gz" "$ARCHIVE_URL"
ACTUAL_SHA256="$(hash_file "$TEMP_DIR/realesrgan.tar.gz")"
if [[ "$ACTUAL_SHA256" != "$ARCHIVE_SHA256" ]]; then
  echo "Real-ESRGAN source checksum did not match." >&2
  exit 1
fi

mkdir -p "$CUDA_ROOT"
rm -rf "$SOURCE_DIR"
tar -xzf "$TEMP_DIR/realesrgan.tar.gz" -C "$TEMP_DIR"
mv "$TEMP_DIR/Real-ESRGAN-0.3.0" "$SOURCE_DIR"
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip wheel setuptools
"$VENV_DIR/bin/python" -m pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu124
"$VENV_DIR/bin/python" -m pip install basicsr facexlib gfpgan -r "$SOURCE_DIR/requirements.txt"
"$VENV_DIR/bin/python" -m pip install --no-deps -e "$SOURCE_DIR"

"$VENV_DIR/bin/python" -c 'import torch; assert torch.cuda.is_available(); print("CUDA ready:", torch.cuda.get_device_name(0))'
echo "DiscStream CUDA backend installed at $CUDA_ROOT"
