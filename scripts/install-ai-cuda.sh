#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${DISCSTREAM_RUNTIME_DIR:-$ROOT_DIR/runtime}"
CUDA_ROOT="$RUNTIME_DIR/data/ai/cuda"
SOURCE_DIR="$CUDA_ROOT/Real-ESRGAN"
VENV_DIR="$CUDA_ROOT/venv"
ARCHIVE_URL="https://github.com/xinntao/Real-ESRGAN/archive/refs/tags/v0.3.0.tar.gz"
ARCHIVE_SHA256="4fbaa9470fc2e2bffa2f6b0e9b7304b3102d7b4d0c4b9dc3a7ff3d237499fed1"
PYTHON_MIN_MINOR=9
PYTHON_MAX_MINOR=12

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "The CUDA backend is supported on Linux with NVIDIA GPUs." >&2
  exit 1
fi
for command_name in curl tar nvidia-smi; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required for the CUDA backend." >&2
    exit 1
  fi
done

python_is_supported() {
  "$1" -c "import sys; raise SystemExit(0 if sys.version_info.major == 3 and $PYTHON_MIN_MINOR <= sys.version_info.minor <= $PYTHON_MAX_MINOR else 1)" \
    >/dev/null 2>&1
}

select_python() {
  local requested="${DISCSTREAM_CUDA_PYTHON:-}"
  if [[ -n "$requested" ]]; then
    if ! command -v "$requested" >/dev/null 2>&1; then
      echo "DISCSTREAM_CUDA_PYTHON does not resolve to an executable: $requested" >&2
      return 1
    fi
    if ! python_is_supported "$requested"; then
      echo "DISCSTREAM_CUDA_PYTHON must use Python 3.$PYTHON_MIN_MINOR through 3.$PYTHON_MAX_MINOR." >&2
      return 1
    fi
    command -v "$requested"
    return
  fi

  local candidate
  for candidate in python3.12 python3.11 python3.10 python3.9 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && python_is_supported "$candidate"; then
      command -v "$candidate"
      return
    fi
  done

  return 1
}

if ! PYTHON_EXECUTABLE="$(select_python)"; then
  detected_version="$(python3 --version 2>/dev/null || echo "not installed")"
  echo "PyTorch 2.5.1 requires Python 3.$PYTHON_MIN_MINOR through 3.$PYTHON_MAX_MINOR; found $detected_version." >&2
  echo "Install a compatible Python and its venv package, then retry." >&2
  echo "Example: sudo apt install python3.12 python3.12-venv" >&2
  echo "You can select it with DISCSTREAM_CUDA_PYTHON=python3.12 pnpm install:ai:cuda" >&2
  exit 1
fi

PYTHON_VERSION="$("$PYTHON_EXECUTABLE" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
echo "Using Python $PYTHON_VERSION at $PYTHON_EXECUTABLE"

if ! "$PYTHON_EXECUTABLE" -m venv --help >/dev/null 2>&1; then
  echo "The venv module is missing for Python $PYTHON_VERSION." >&2
  echo "Install the matching package, for example: sudo apt install python3.12-venv" >&2
  exit 1
fi
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
if [[ -x "$VENV_DIR/bin/python" ]]; then
  VENV_PYTHON_VERSION="$("$VENV_DIR/bin/python" -c 'import sys; print(".".join(map(str, sys.version_info[:2])))' 2>/dev/null || true)"
  SELECTED_PYTHON_VERSION="$("$PYTHON_EXECUTABLE" -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')"
  if [[ "$VENV_PYTHON_VERSION" != "$SELECTED_PYTHON_VERSION" ]]; then
    echo "Recreating the existing Python $VENV_PYTHON_VERSION environment with Python $SELECTED_PYTHON_VERSION."
    rm -rf "$VENV_DIR"
  fi
fi
"$PYTHON_EXECUTABLE" -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip wheel setuptools
"$VENV_DIR/bin/python" -m pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu124
"$VENV_DIR/bin/python" -m pip install basicsr facexlib gfpgan -r "$SOURCE_DIR/requirements.txt"
"$VENV_DIR/bin/python" -m pip install --no-deps -e "$SOURCE_DIR"

"$VENV_DIR/bin/python" -c 'import torch; assert torch.cuda.is_available(); print("CUDA ready:", torch.cuda.get_device_name(0))'
echo "DiscStream CUDA backend installed at $CUDA_ROOT"
