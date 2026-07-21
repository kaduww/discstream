#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${DISCSTREAM_RUNTIME_DIR:-$ROOT_DIR/runtime}"
ENV_FILE="${DISCSTREAM_ENV_FILE:-$RUNTIME_DIR/config/discstream.env}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install pnpm, then run this script again." >&2
  exit 1
fi

mkdir -p \
  "$RUNTIME_DIR/config" \
  "$RUNTIME_DIR/data" \
  "$RUNTIME_DIR/cache" \
  "$RUNTIME_DIR/logs" \
  "$RUNTIME_DIR/streams" \
  "$RUNTIME_DIR/covers"
mkdir -p "$(dirname "$ENV_FILE")"

cd "$ROOT_DIR"
pnpm install --frozen-lockfile
pnpm --filter @discstream/web build

if [[ ! -f "$ENV_FILE" ]]; then
  {
    echo "# DiscStream runtime configuration"
    echo "DISCSTREAM_HOST=${DISCSTREAM_HOST:-0.0.0.0}"
    echo "DISCSTREAM_PORT=${DISCSTREAM_PORT:-7373}"
    echo "DISCSTREAM_RUNTIME_DIR=$RUNTIME_DIR"
    echo "DISCSTREAM_LOCAL_MEDIA_BROWSE_ROOTS=${DISCSTREAM_LOCAL_MEDIA_BROWSE_ROOTS:-}"
    echo "DISCSTREAM_LOCAL_MEDIA_ROOTS=${DISCSTREAM_LOCAL_MEDIA_ROOTS:-}"
    echo "DISCSTREAM_LOCAL_MEDIA_EXTENSIONS=${DISCSTREAM_LOCAL_MEDIA_EXTENSIONS:-.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus,.mp4,.m4v,.mov,.mkv,.webm,.avi,.mpeg,.mpg}"
    echo "LOG_LEVEL=${LOG_LEVEL:-info}"
    echo "DISCSTREAM_LOG_FILE=${DISCSTREAM_LOG_FILE:-$RUNTIME_DIR/logs/server.log}"
  } > "$ENV_FILE"
fi

echo "DiscStream is prepared."
echo "Runtime directory: $RUNTIME_DIR"
echo "Environment file: $ENV_FILE"
echo
echo "Run locally with:"
echo "  set -a && . \"$ENV_FILE\" && set +a && pnpm --filter @discstream/server start"
