# DiscStream Setup

DiscStream can run from the workspace during development or as a long-running local service.

## Prepare The Workspace

```sh
pnpm install
pnpm --filter @discstream/web build
```

For a repeatable setup, use:

```sh
./scripts/install.sh
```

The installer creates the runtime folders and a default environment file.

## Diagnostics

Run the local doctor before testing CD/DVD playback:

```sh
pnpm run doctor
```

It checks runtime folders, FFmpeg/FFprobe, optical-drive helper commands, configured local media roots, the server port, and the health endpoint when the server is running.

## Runtime Folders

By default, development data is stored under `runtime/` in the repository.

Installed mode should set `DISCSTREAM_RUNTIME_DIR` to a platform-specific location:

- Linux: `/var/lib/discstream`
- macOS: `$HOME/Library/Application Support/DiscStream`

DiscStream creates these folders under the runtime directory:

- `config`
- `data`
- `cache`
- `logs`
- `streams`
- `covers`

Each folder can also be overridden individually:

- `DISCSTREAM_CONFIG_DIR`
- `DISCSTREAM_DATA_DIR`
- `DISCSTREAM_CACHE_DIR`
- `DISCSTREAM_LOG_DIR`
- `DISCSTREAM_STREAMS_DIR`
- `DISCSTREAM_COVERS_DIR`

## Environment

Common variables:

```sh
DISCSTREAM_HOST=0.0.0.0
DISCSTREAM_PORT=7373
DISCSTREAM_RUNTIME_DIR=/var/lib/discstream
DISCSTREAM_LOCAL_MEDIA_ROOTS=/media/music:/media/videos
DISCSTREAM_LOCAL_MEDIA_BROWSE_ROOTS=/media:/mnt:/home
DISCSTREAM_LOCAL_MEDIA_EXTENSIONS=.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus,.mp4,.m4v,.mov,.mkv,.webm,.avi,.mpeg,.mpg
LOG_LEVEL=info
DISCSTREAM_LOG_FILE=/var/lib/discstream/logs/server.log
```

`DISCSTREAM_LOCAL_MEDIA_ROOTS` and `DISCSTREAM_LOCAL_MEDIA_BROWSE_ROOTS` use the platform path delimiter:

- Linux/macOS: `:`
- Windows, if used later: `;`

## Run Manually

```sh
set -a
. ./runtime/config/discstream.env
set +a
pnpm --filter @discstream/server start
```

Open `http://localhost:7373/` after building the web app. During development, `pnpm dev` still runs the Vite UI separately on `http://localhost:5173/`.

## Linux systemd

1. Copy the project to `/opt/discstream`.
2. Create a service user and runtime folders:

```sh
sudo useradd --system --home /var/lib/discstream --shell /usr/sbin/nologin discstream
sudo mkdir -p /var/lib/discstream /etc/discstream
sudo chown -R discstream:discstream /var/lib/discstream
```

3. Build the app and create the environment file:

```sh
cd /opt/discstream
DISCSTREAM_RUNTIME_DIR=/var/lib/discstream DISCSTREAM_ENV_FILE=./discstream.env ./scripts/install.sh
```

4. Copy the generated environment file:

```sh
sudo cp ./discstream.env /etc/discstream/discstream.env
sudo chown root:root /etc/discstream/discstream.env
```

5. Review `/etc/discstream/discstream.env` and add any media roots. Make sure the `discstream` user can read those folders and access the optical drive.
6. Install and start the service:

```sh
sudo cp packaging/systemd/discstream.service /etc/systemd/system/discstream.service
sudo systemctl daemon-reload
sudo systemctl enable --now discstream
```

Useful checks:

```sh
systemctl status discstream
journalctl -u discstream -f
tail -f /var/lib/discstream/logs/server.log
```

## macOS launchd

1. Choose a project path, for example `~/Applications/DiscStream`.
2. Prepare the runtime:

```sh
cd ~/Applications/DiscStream
DISCSTREAM_RUNTIME_DIR="$HOME/Library/Application Support/DiscStream" ./scripts/install.sh
```

3. Edit `packaging/launchd/com.discstream.server.plist` and replace `/path/to/DiscStream` with the project path.
4. Install and start the LaunchAgent:

```sh
mkdir -p "$HOME/Library/LaunchAgents"
cp packaging/launchd/com.discstream.server.plist "$HOME/Library/LaunchAgents/com.discstream.server.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.discstream.server.plist"
launchctl enable "gui/$(id -u)/com.discstream.server"
launchctl kickstart -k "gui/$(id -u)/com.discstream.server"
```

Useful checks:

```sh
launchctl print "gui/$(id -u)/com.discstream.server"
tail -f "$HOME/Library/Application Support/DiscStream/logs/server.log"
tail -f "$HOME/Library/Application Support/DiscStream/logs/server.out.log" "$HOME/Library/Application Support/DiscStream/logs/server.err.log"
```

## Local Network Access

With `DISCSTREAM_HOST=0.0.0.0`, devices on the same trusted network can open:

```text
http://SERVER_IP:7373/
```

Keep DiscStream on a trusted LAN for now. Authentication is intentionally deferred in the MVP.
