# DiscStream

DiscStream is a local web media appliance for Audio CDs, DVD-Video discs, and selected local media folders. It turns a Mac, Linux machine, Raspberry Pi, or similar host with an optical drive into a browser-based CD/DVD player for the local network.

The goal is simple: keep physical discs and local media usable on modern screens. Insert a CD or DVD, add trusted media folders, open DiscStream from a browser, and control playback from a computer, iPad, phone, TV browser, Android TV, or Xiaomi Mi Box without moving the drive or storage device to the TV.

## What It Does

DiscStream provides a single local player for:

- Audio CDs in an attached optical drive.
- DVD-Video discs in an attached optical drive.
- Local audio files such as MP3, M4A, AAC, FLAC, WAV, Ogg Vorbis, and Opus where the host can read them.
- Local video files such as MP4, M4V, MOV, MKV, WebM, AVI, MPEG, and MPG through direct playback or HLS transcoding.
- Local DVD-Video folders such as `VIDEO_TS` when FFmpeg or platform tools can read them.
- Configured local media folders, organized by subdirectory inside the web UI.

DiscStream is designed for a trusted home network. It is not intended to be exposed directly to the internet.

## Product Experience

The web UI is designed to feel like a media player rather than a technical dashboard:

- Large primary video/player area.
- Compact disc tray panel for CD/DVD controls.
- DVD title, chapter, audio track, subtitle, and quality controls.
- CD track list with pause, stop, next track, previous track, seek, and volume controls.
- Local media shelf with folder grouping, search, type filters, sorting, and artwork when available.
- TV mode with larger controls and visible focus states for remote-style navigation.
- Responsive layouts for desktop, iPad portrait/landscape, mobile, and TV browser viewports.
- System check panel for diagnostics without making the main player feel technical.

## Key Features

### Audio CD Playback

- Detects Audio CDs on supported macOS and Linux hosts.
- Lists separate tracks.
- Streams tracks to the browser in a compatible audio format.
- Supports play, pause, stop, previous track, next track, seek, and volume.
- Can look up album, artist, track names, release candidates, and cover art through MusicBrainz/Cover Art Archive when metadata lookup is enabled.
- Supports manual CD metadata editing and local metadata caching.

### DVD Playback

- Detects DVD-Video discs and readable DVD-Video folders.
- Inspects titles, likely main title, chapters, audio tracks, subtitle tracks, duration, and aspect ratio when the host tools can read them.
- Streams DVD video through browser-compatible HLS.
- Supports DVD title and chapter selection.
- Supports audio and subtitle selection where available.
- Offers video quality profiles for fast start, balanced playback, or best image.
- Uses hardware H.264 encoding when available, including VideoToolbox on macOS and V4L2 on Linux, with software H.264 fallback.

### Local Media

- Lets the user add media folders from the server-side filesystem through the UI.
- Restricts browsing and playback to configured or allowed local media roots.
- Shows media grouped by subdirectory for easier navigation.
- Supports direct playback for browser-compatible audio/video.
- Uses FFmpeg/HLS for readable media that requires transcoding.
- Shows embedded or sidecar artwork/cover images when available.
- Supports resume entries for recent local media, CD tracks, and DVD titles.

### Diagnostics And Runtime

- Reports platform, architecture, command availability, FFmpeg status, encoder availability, runtime paths, logs, local media roots, and stream cache details.
- Uses structured API errors with readable hints.
- Uses WebSocket updates for runtime UI state instead of relying on screen polling.
- Cleans up playback processes and temporary stream files when sessions stop.
- Provides install scripts, runtime folders, Linux systemd packaging, and macOS launchd packaging.

## Supported Targets

DiscStream currently focuses on:

- macOS hosts, including Apple Silicon and Intel setups.
- Linux hosts, including Raspberry Pi-style setups where performance allows.
- USB or internal CD/DVD drives readable by the host operating system.
- Local-network browsers on desktop, iPad/tablet, phone, TV browser and Android TV.

DVD performance depends heavily on the host. A capable Mac is the preferred DVD transcoding host. Raspberry Pi-class devices may need lower quality settings or may only provide capability warnings for DVD video.

## Requirements

- Node.js and pnpm.
- FFmpeg and FFprobe for DVD, video transcoding, and deeper media probing.
- A readable optical drive for physical CD/DVD playback.
- Optional platform helpers such as `diskutil`/`drutil` on macOS and Linux drive inspection tools.
- A trusted local network if other devices will open the player.

## Development

Install dependencies:

```sh
pnpm install
```

Start the development server:

```sh
pnpm dev
```

The API runs on:

```text
http://localhost:7373
```

The web app runs on the Vite port shown in the terminal, usually:

```text
http://localhost:5173
```

During development the web app proxies `/api` calls to the server.

## Local Media Folders

Local media can be added through the UI with the server-side folder picker.

You can also preconfigure roots with `DISCSTREAM_LOCAL_MEDIA_ROOTS`. Use the platform path delimiter:

- Linux/macOS: `:`
- Windows, if used later: `;`

Example:

```sh
DISCSTREAM_LOCAL_MEDIA_ROOTS="/Users/me/Music:/Users/me/Videos" pnpm dev
```

For safer browsing through the UI folder picker, configure browse roots with `DISCSTREAM_LOCAL_MEDIA_BROWSE_ROOTS`.

## Running As A Service

DiscStream can run as a long-running local service.

For local service setup, runtime folders, Linux systemd, and macOS launchd instructions, see:

- [docs/setup.md](./docs/setup.md)

## Diagnostics

Run a local environment check with:

```sh
pnpm run doctor
```

The doctor checks runtime folders, FFmpeg/FFprobe, optical-drive helper commands, configured local media roots, server port usage, and the health endpoint when the server is running.

## Testing

Run the regular checks:

```sh
pnpm typecheck
pnpm test
pnpm test:smoke
```

Run the browser smoke test against a running local UI:

```sh
pnpm run test:browser-smoke
```

The browser smoke test validates desktop, iPad portrait, iPad landscape, and TV browser layouts. If Playwright browser binaries are missing on a clean machine, install Chromium once:

```sh
pnpm exec playwright install chromium
```

For the full automated and hardware validation flow, see:

- [docs/testing.md](./docs/testing.md)
- [docs/hardware-test-checklist.md](./docs/hardware-test-checklist.md)

## Current Limitations

- DiscStream does not bypass DVD copy protection.
- Authentication is intentionally deferred for the MVP; keep the service on a trusted LAN.
- DVD playback depends on host performance, optical drive readability, FFmpeg support, and available encoders.
- Perfect DVD menu emulation is out of scope. DiscStream exposes title, chapter, audio, subtitle, and quality controls instead.
- Local CD/DVD image playback is planned but not the primary supported path yet.

## License

DiscStream is released under the GNU General Public License v3.0. See [LICENSE](./LICENSE).

## Project Documentation

- [discstream-prd.md](./discstream-prd.md) describes the product requirements and roadmap.
- [docs/setup.md](./docs/setup.md) describes installation and runtime setup.
- [docs/testing.md](./docs/testing.md) describes automated and browser testing.
- [docs/hardware-test-checklist.md](./docs/hardware-test-checklist.md) describes manual validation with real drives and devices.
