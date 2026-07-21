#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ENV_FILE="$ROOT_DIR/runtime/config/discstream.env"
ENV_FILE="${DISCSTREAM_ENV_FILE:-$DEFAULT_ENV_FILE}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

RUNTIME_DIR="${DISCSTREAM_RUNTIME_DIR:-$ROOT_DIR/runtime}"
CONFIG_DIR="${DISCSTREAM_CONFIG_DIR:-$RUNTIME_DIR/config}"
DATA_DIR="${DISCSTREAM_DATA_DIR:-$RUNTIME_DIR/data}"
CACHE_DIR="${DISCSTREAM_CACHE_DIR:-$RUNTIME_DIR/cache}"
LOG_DIR="${DISCSTREAM_LOG_DIR:-$RUNTIME_DIR/logs}"
STREAMS_DIR="${DISCSTREAM_STREAMS_DIR:-$RUNTIME_DIR/streams}"
COVERS_DIR="${DISCSTREAM_COVERS_DIR:-$RUNTIME_DIR/covers}"
PORT="${DISCSTREAM_PORT:-7373}"

WARNINGS=0
FAILURES=0

section() {
  printf "\n%s\n" "$1"
}

ok() {
  printf "  OK   %s\n" "$1"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf "  WARN %s\n" "$1"
}

fail() {
  FAILURES=$((FAILURES + 1))
  printf "  FAIL %s\n" "$1"
}

check_command() {
  local name="$1"
  local hint="$2"

  if command -v "$name" >/dev/null 2>&1; then
    ok "$name found at $(command -v "$name")"
  else
    warn "$name not found. $hint"
  fi
}

check_dir() {
  local label="$1"
  local dir="$2"

  if [[ ! -d "$dir" ]]; then
    warn "$label does not exist: $dir"
    return
  fi

  if [[ ! -w "$dir" ]]; then
    fail "$label is not writable: $dir"
    return
  fi

  ok "$label is writable: $dir"
}

check_port() {
  local port="$1"

  if ! command -v lsof >/dev/null 2>&1; then
    warn "lsof not found, skipping port check."
    return
  fi

  local listeners
  listeners="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$listeners" ]]; then
    warn "nothing is listening on port $port."
    return
  fi

  ok "port $port is in use by:"
  printf "%s\n" "$listeners" | sed 's/^/       /'
}

check_health() {
  local port="$1"

  if ! command -v curl >/dev/null 2>&1; then
    warn "curl not found, skipping API health check."
    return
  fi

  local response
  response="$(curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" 2>/dev/null || true)"
  if [[ "$response" == *'"ok":true'* ]]; then
    ok "API health endpoint responded on port $port."
  else
    warn "API health endpoint did not respond on port $port."
  fi
}

check_local_roots() {
  local roots="${DISCSTREAM_LOCAL_MEDIA_ROOTS:-}"

  if [[ -z "$roots" ]]; then
    warn "no local media roots configured yet."
    return
  fi

  local old_ifs="$IFS"
  IFS=":"
  read -ra entries <<< "$roots"
  IFS="$old_ifs"

  local root
  for root in "${entries[@]}"; do
    if [[ -z "$root" ]]; then
      continue
    fi
    if [[ -d "$root" && -r "$root" ]]; then
      ok "local media root is readable: $root"
    elif [[ -d "$root" ]]; then
      fail "local media root exists but is not readable: $root"
    else
      warn "local media root does not exist: $root"
    fi
  done
}

check_optical_tools() {
  case "$(uname -s)" in
    Darwin)
      check_command diskutil "Install or restore macOS disk utilities."
      check_command drutil "Install or restore macOS disc utilities."
      ;;
    Linux)
      check_command lsblk "Install util-linux."
      check_command eject "Install the eject package if tray control is needed."
      check_command udevadm "Install udev if drive event monitoring is needed."
      ;;
    *)
      warn "unsupported platform for optical drive automation: $(uname -s)"
      ;;
  esac
}

printf "DiscStream doctor\n"
printf "Workspace: %s\n" "$ROOT_DIR"
if [[ -f "$ENV_FILE" ]]; then
  printf "Environment: %s\n" "$ENV_FILE"
else
  printf "Environment: not found at %s\n" "$ENV_FILE"
fi

section "Runtime"
check_dir "config directory" "$CONFIG_DIR"
check_dir "data directory" "$DATA_DIR"
check_dir "cache directory" "$CACHE_DIR"
check_dir "logs directory" "$LOG_DIR"
check_dir "streams directory" "$STREAMS_DIR"
check_dir "covers directory" "$COVERS_DIR"

section "Commands"
check_command node "Install Node.js."
check_command pnpm "Install pnpm."
check_command ffmpeg "Install FFmpeg for DVD/video streaming."
check_command ffprobe "Install FFprobe for media inspection."
check_optical_tools

section "Local Media"
check_local_roots

section "Server"
check_port "$PORT"
check_health "$PORT"

section "Summary"
if [[ "$FAILURES" -gt 0 ]]; then
  fail "$FAILURES failure(s) and $WARNINGS warning(s) found."
  exit 1
fi

if [[ "$WARNINGS" -gt 0 ]]; then
  warn "$WARNINGS warning(s) found."
  exit 0
fi

ok "no problems found."
