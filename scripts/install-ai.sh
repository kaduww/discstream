#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${DISCSTREAM_RUNTIME_DIR:-$ROOT_DIR/runtime}"
AI_ROOT="$RUNTIME_DIR/data/ai"
INSTALL_DIR="$AI_ROOT/realesrgan"
case "$(uname -s)" in
  Darwin)
    RELEASE_URL="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip"
    EXPECTED_SHA256="e0ad05580abfeb25f8d8fb55aaf7bedf552c375b5b4d9bd3c8d59764d2cc333a"
    ;;
  Linux)
    RELEASE_URL="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip"
    EXPECTED_SHA256="e5aa6eb131234b87c0c51f82b89390f5e3e642b7b70f2b9bbe95b6a285a40c96"
    ;;
  *)
    echo "The project-local AI installer supports macOS and Linux." >&2
    exit 1
    ;;
esac

for command_name in curl unzip; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required to install the AI backend." >&2
    exit 1
  fi
done
if command -v shasum >/dev/null 2>&1; then
  hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }
elif command -v sha256sum >/dev/null 2>&1; then
  hash_file() { sha256sum "$1" | awk '{print $1}'; }
else
  echo "shasum or sha256sum is required to verify the AI package." >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/discstream-ai.XXXXXX")"
ARCHIVE_PATH="$TEMP_DIR/realesrgan.zip"
EXTRACT_DIR="$TEMP_DIR/package"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "Downloading the official portable Real-ESRGAN package..."
curl -fL --retry 2 -o "$ARCHIVE_PATH" "$RELEASE_URL"

ACTUAL_SHA256="$(hash_file "$ARCHIVE_PATH")"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  echo "Real-ESRGAN archive checksum did not match the expected official package." >&2
  exit 1
fi

mkdir -p "$EXTRACT_DIR" "$AI_ROOT"
unzip -q "$ARCHIVE_PATH" -d "$EXTRACT_DIR"
chmod u+x "$EXTRACT_DIR/realesrgan-ncnn-vulkan"

if [[ ! -d "$EXTRACT_DIR/models" || ! -x "$EXTRACT_DIR/realesrgan-ncnn-vulkan" ]]; then
  echo "Real-ESRGAN package is incomplete." >&2
  exit 1
fi

BACKUP_DIR="$AI_ROOT/realesrgan.previous"
if [[ -d "$BACKUP_DIR" ]]; then
  rm -rf "$BACKUP_DIR"
fi
if [[ -d "$INSTALL_DIR" ]]; then
  mv "$INSTALL_DIR" "$BACKUP_DIR"
fi

mv "$EXTRACT_DIR" "$INSTALL_DIR"
if [[ -d "$BACKUP_DIR" ]]; then
  rm -rf "$BACKUP_DIR"
fi

echo
echo "Real-ESRGAN was installed only for this DiscStream workspace."
echo "Executable: $INSTALL_DIR/realesrgan-ncnn-vulkan"
echo "Models: $INSTALL_DIR/models"
