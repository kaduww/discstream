# DiscStream Product Requirements Document

**Product:** DiscStream  
**Document type:** Product Requirements Document (PRD)  
**Target implementation:** Codex-assisted development  
**Primary platforms:** Linux/Raspberry Pi and macOS Intel/Apple Silicon  
**Document date:** 2026-07-20  
**Status:** Draft v1

---

## 1. Summary

DiscStream is a cross-platform, web-based media server for physical CD and DVD drives and selected local media files. It turns a USB or internal optical drive, plus configured local media folders, into a local web streaming appliance that can be controlled from a browser on a phone, iPad/tablet, computer, Android TV, Xiaomi Mi Box, TV browser, or other local-network device.

The system detects an inserted CD or DVD, identifies available media content, indexes configured local media sources, exposes a responsive web interface, and streams playback through standard browser-compatible formats. It should run autonomously on either a Raspberry Pi/Linux machine or a macOS Mac Mini, adapting behavior according to platform capabilities, available commands, hardware acceleration, local file access, and drive support.

The long-term vision is a modern "YouTube/Spotify-like" experience for physical and local media: insert a disc or choose an authorized local file, open a local web app, press play, and control playback without needing to connect the optical drive or storage device directly to the TV.

---

## 2. Vision

DiscStream should make physical and local media feel native to modern networked devices.

Instead of treating CDs and DVDs as legacy formats that require dedicated players, DiscStream provides a browser-based media experience:

- Insert a CD or DVD into a drive connected to a Raspberry Pi, Mac Mini, or Linux/macOS host.
- Choose an authorized local audio file, video file, DVD-Video folder, or readable disc image from configured local media directories.
- Open `http://discstream.local` or the server IP from any browser.
- See the detected disc or local media item, metadata, tracks, titles, chapters, and playback controls.
- Start, stop, pause, seek, change tracks, eject the disc when applicable, and stream playback over the local network.

The product should be simple enough for home use, modular enough for future expansion, and explicit about platform differences so the same codebase can support both low-power Linux systems and more capable macOS hosts.

---

## 3. Goals

### 3.1 Product Goals

- Provide a web interface for controlling CD/DVD and configured local media playback from any browser on the local network.
- Support both Linux/Raspberry Pi and macOS Intel/Apple Silicon from the first architecture.
- Detect available optical drives and inserted media automatically.
- Stream audio CDs and DVD video in browser-compatible formats.
- Play configured local media files, including MP3 files, other common audio/video formats, and local CD/DVD-derived media where supported.
- Expose a clear API that separates platform operations, disc inspection, streaming sessions, and UI state.
- Start with a practical MVP, then evolve toward a polished physical and local media streaming appliance.

### 3.2 MVP Goals

The first usable version must:

- Start a local web server.
- Detect the current operating system.
- Detect at least one optical drive when available.
- Report drive status through API and UI.
- Support tray eject when the platform/hardware allows it.
- Detect whether inserted media appears to be an audio CD, DVD-Video, data disc, unknown disc, or no disc.
- Provide a responsive web UI with clear empty, loading, error, CD, DVD, local media, and playback states.
- Stream at least one audio CD track through a browser.
- Stream at least one configured local MP3 file through a browser as the first local-file playback path.
- Provide an initial DVD streaming proof-of-concept through HLS when the host has working FFmpeg support.
- Stop active streaming processes cleanly.
- Include installation and diagnostic scripts for Linux and macOS.

### 3.3 Long-Term Goals

- Rich CD metadata using MusicBrainz/libdiscid and cover art.
- DVD title/chapter/audio/subtitle selection.
- Automatic main-title detection for DVDs.
- Resume playback.
- Local history and favorites.
- Browsing configured local media folders with metadata for MP3, other audio/video files, DVD-Video folders, and readable CD/DVD images.
- Optional authentication.
- Progressive Web App behavior.
- Remote control mode where one device controls playback on another.
- Optional caching or ripping workflows.
- Future distributed mode where a Raspberry Pi hosts the drive and a Mac performs heavy transcoding.

---

## 4. Non-Goals

These are intentionally out of scope for the MVP:

- Blu-ray playback.
- Bypassing DRM, copy protection, region locks, or encryption.
- Permanent ripping as the default behavior.
- Internet-facing hosting.
- Cloud sync.
- Multi-user account management.
- Multi-drive orchestration beyond basic detection of more than one drive.
- Unrestricted browsing of the host filesystem from the web UI.
- Full automatic indexing of all local disks.
- Perfect DVD menu emulation.
- Native Android TV app.
- Chromecast/AirPlay casting.
- Distributed Raspberry Pi plus Mac transcoding mode.
- Full media-library replacement for Jellyfin, Plex, or Kodi.

DiscStream may later integrate with or complement media-library systems, but the initial product is focused on live control and streaming from a currently inserted physical disc or explicitly configured local media source.

---

## 5. Assumptions

- The user owns or is authorized to play the inserted media.
- The user owns or is authorized to play local files and folders configured as DiscStream media sources.
- The server is used on a trusted local network.
- The host has permission to access the optical drive.
- The host has read permission for configured local media directories.
- DVD playback support depends on whether the disc is readable by the operating system and installed libraries.
- Local DVD/CD-derived playback support depends on whether the file, folder, or image is readable by FFmpeg or installed helper tools.
- Browser-compatible DVD streaming generally requires transcoding DVD MPEG-2 video and DVD audio into H.264/AAC or another browser-compatible profile.
- Raspberry Pi 3 may be too slow for real-time DVD transcoding without hardware acceleration or quality reductions.
- Mac Mini Intel and newer Apple Silicon Macs are expected to be better DVD transcoding hosts.
- Platform capabilities must be detected at runtime instead of assumed.

---

## 6. Personas

### 6.1 Home Media Owner

Owns a collection of CDs and DVDs and wants to use them from modern screens without keeping a dedicated DVD player connected.

Needs:

- Simple insert-and-play flow.
- Works on TV browser, phone, and laptop.
- Clear status when a disc cannot be played.
- No complex command-line operation after installation.

### 6.2 Technical Hobbyist

Has Raspberry Pi, Mac Mini, USB DVD drive, and a home network. Enjoys building useful local appliances.

Needs:

- Transparent diagnostics.
- Configurable streaming profiles.
- Logs and troubleshooting tools.
- Clean architecture for adding features.

### 6.3 Living Room Viewer

Uses Xiaomi Mi Box, Android TV, tablet, or phone as the control/playback surface.

Needs:

- Remote-friendly UI.
- Large controls.
- Fast start/stop.
- Minimal typing.
- Playback that survives screen size differences.

### 6.4 Developer Contributor

Wants to extend DiscStream, add platform adapters, improve media detection, or integrate metadata providers.

Needs:

- Typed API contracts.
- Modular packages.
- Tests around platform parsing and stream planning.
- Mock mode for development without a physical drive.

---

## 7. Primary Use Cases

### 7.1 Play an Audio CD From a Browser

1. User connects a USB CD/DVD drive to the DiscStream host.
2. User inserts an audio CD.
3. DiscStream detects the drive event.
4. UI updates to show a CD state.
5. DiscStream reads the track list.
6. User selects a track or presses play.
7. Server starts an audio streaming process.
8. Browser plays the stream through an HTML5 audio player.
9. User pauses, resumes, skips tracks, stops, or ejects the disc.

### 7.2 Watch a DVD From a Browser

1. User inserts a DVD-Video disc.
2. DiscStream detects the disc and inspects its structure.
3. UI shows DVD title, available titles, estimated duration, chapters, audio tracks, and subtitles when available.
4. User presses play.
5. Server starts FFmpeg using the selected platform streaming profile.
6. Server generates HLS playlist and segments.
7. Browser loads the HLS playlist through native HLS support or hls.js.
8. User pauses locally, seeks where supported, stops, or ejects.

### 7.3 Use Mac Mini as Main Server

1. User installs DiscStream on macOS.
2. DiscStream detects `darwin`, `diskutil`, `drutil`, FFmpeg, and VideoToolbox support.
3. User connects optical drive to the Mac Mini.
4. DiscStream chooses `h264_videotoolbox` when available for DVD video.
5. User streams from phone, computer, or Mi Box browser.

### 7.4 Use Raspberry Pi as Main Server

1. User installs DiscStream on Raspberry Pi OS or Linux.
2. DiscStream detects `linux`, `/dev/sr*` devices, `lsblk`, `udev`/polling capability, FFmpeg, and available encoders.
3. User connects optical drive to Raspberry Pi.
4. CD streaming works as the primary reliable path.
5. DVD streaming uses hardware H.264 when available or a low-quality software fallback.
6. Diagnostics warn when DVD transcoding is unlikely to work in real time.

### 7.5 Diagnose a Playback Failure

1. User opens diagnostics page or runs diagnostic script.
2. DiscStream reports platform, architecture, drive detection, commands, permissions, encoders, writable directories, and last streaming error.
3. UI provides a human-readable explanation.
4. Logs preserve technical details for developers.

### 7.6 Play a Local Media File

1. User configures one or more local media directories on the DiscStream host.
2. DiscStream scans or lists authorized media files and folders.
3. UI shows available MP3 files, supported audio/video files, DVD-Video folders, and readable CD/DVD image candidates.
4. User selects a local item and presses play.
5. Server chooses direct browser playback for compatible files such as MP3, or starts FFmpeg/HLS when transcoding or DVD-style streaming is required.
6. Browser plays the stream through an HTML5 audio or video player.
7. User pauses, seeks, stops, or returns to the local media list.

---

## 8. Functional Requirements

Requirement priorities:

- **P0:** Required for MVP.
- **P1:** Required soon after MVP.
- **P2:** Future enhancement.

### 8.1 Application Startup

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-001 | P0 | The server must start on Linux and macOS using one command in development mode. |
| FR-002 | P0 | The server must detect OS platform using Node.js runtime information. |
| FR-003 | P0 | Unsupported platforms must fail with a clear error. |
| FR-004 | P0 | Startup must load exactly one platform adapter for the current platform. |
| FR-005 | P0 | Startup must verify required runtime directories and create missing writable app directories. |
| FR-006 | P0 | Startup must expose platform capability status through API. |

### 8.2 Platform Detection and Capabilities

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-010 | P0 | The system must detect `linux` and `darwin` platforms. |
| FR-011 | P0 | The system must detect CPU architecture. |
| FR-012 | P0 | The system must detect availability of `ffmpeg` and `ffprobe`. |
| FR-013 | P0 | The system must detect H.264 encoders exposed by FFmpeg. |
| FR-014 | P0 | The system must detect platform drive-control commands. |
| FR-015 | P0 | Capabilities must be represented as structured JSON. |
| FR-016 | P1 | The system should detect Raspberry Pi hardware model when running on Linux. |
| FR-017 | P1 | The system should detect whether the app likely has permission to access optical devices. |

### 8.3 Optical Drive Management

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-020 | P0 | The system must list detected optical drives. |
| FR-021 | P0 | The system must represent each drive using a normalized model independent of OS. |
| FR-022 | P0 | The system must expose current drive status through `GET /api/drive`. |
| FR-023 | P0 | The system must support no-drive, tray-open, empty, media-present, busy, and error states. |
| FR-024 | P0 | The system must support eject when the platform and hardware support it. |
| FR-025 | P1 | The system should support tray close when the platform and hardware support it. |
| FR-026 | P1 | The system should detect drive insert/remove changes without requiring page refresh. |
| FR-027 | P1 | The system should support selecting a specific drive when multiple drives exist. |

### 8.4 Disc Detection

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-030 | P0 | The system must detect no disc. |
| FR-031 | P0 | The system must distinguish at least audio CD, DVD-Video, data disc, and unknown disc. |
| FR-032 | P0 | The system must expose disc state through `GET /api/disc`. |
| FR-033 | P0 | Disc detection failures must return a structured error with human-readable guidance. |
| FR-034 | P1 | Audio CDs should expose track count and estimated durations. |
| FR-035 | P1 | DVDs should expose title count and likely main title when possible. |
| FR-036 | P2 | DVD inspection should expose chapters, audio tracks, subtitle tracks, angles, and durations. |

### 8.5 Audio CD Playback

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-040 | P0 | The system must stream at least one audio CD track to a browser. |
| FR-041 | P0 | Audio streaming must use browser-compatible audio. |
| FR-042 | P0 | User must be able to start and stop audio playback from the web UI. |
| FR-043 | P1 | User should be able to select a track from the CD track list. |
| FR-044 | P1 | User should be able to skip to previous and next tracks. |
| FR-045 | P1 | User should be able to see current track status. |
| FR-046 | P1 | Audio streaming should avoid permanent ripping by default. |
| FR-047 | P2 | The system should support optional temporary caching to improve reliability. |

### 8.6 DVD Playback

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-050 | P0 | The system must provide an experimental DVD HLS streaming path when FFmpeg can read the input. |
| FR-051 | P0 | DVD playback must use a browser-compatible streaming format. |
| FR-052 | P0 | User must be able to start and stop DVD streaming from the web UI. |
| FR-053 | P0 | The system must clean up FFmpeg processes after stop or failure. |
| FR-054 | P1 | The system should select the best streaming profile based on detected capabilities. |
| FR-055 | P1 | The system should choose a likely main DVD title automatically. |
| FR-056 | P1 | User should be able to select DVD title/chapter where available. |
| FR-057 | P2 | User should be able to select audio and subtitle tracks. |
| FR-058 | P2 | User should be able to resume DVD playback. |

### 8.7 Local Media File Playback

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-100 | P0 | The system must support configured local media directories as an optional playback source. |
| FR-101 | P0 | Local media access must be restricted to configured allowlisted directories or explicit file references. |
| FR-102 | P0 | The system must list playable local audio files, with MP3 as the first required local audio format. |
| FR-103 | P0 | The system must play local MP3 files through browser-compatible direct streaming without transcoding when possible. |
| FR-104 | P1 | The system should support local DVD-Video folders such as `VIDEO_TS` when FFmpeg or helper tools can read them. |
| FR-105 | P2 | The system should support readable local CD/DVD image files such as `.iso` or `.cue/.bin` when platform tools allow inspection or playback. |
| FR-106 | P1 | The system should support additional local audio formats such as AAC/M4A, FLAC, WAV, Ogg Vorbis, and Opus through direct playback or transcoding. |
| FR-107 | P0 | Local media playback failures must return structured errors with human-readable guidance. |
| FR-108 | P1 | The system should list playable local video files, with MP4/H.264/AAC as the first preferred local video profile. |
| FR-109 | P1 | The system should play browser-compatible local video files directly with HTTP range support when possible. |
| FR-110 | P1 | The system should transcode common readable local video files such as MKV, MOV, AVI, MPEG, and WebM to browser-compatible HLS when direct playback is unavailable. |
| FR-111 | P2 | The system should expose embedded or sidecar subtitles for local video files where available. |

### 8.8 Streaming Sessions

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-060 | P0 | The system must support one active playback session at a time in MVP. |
| FR-061 | P0 | Starting a new session must stop or reject an existing active session with a clear policy. |
| FR-062 | P0 | Each session must have a unique ID. |
| FR-063 | P0 | Each session must expose status: starting, buffering, playing, stopped, failed. |
| FR-064 | P0 | Session state must be available through API. |
| FR-065 | P0 | Temporary stream files must be written under the app cache directory. |
| FR-066 | P0 | Temporary stream files must be cleaned up after stop/failure. |
| FR-067 | P1 | Session updates should be pushed through WebSocket. |
| FR-068 | P1 | Session logs should include command, profile, start time, stop time, exit code, and stderr excerpt. |

### 8.9 Metadata

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-070 | P1 | Audio CDs should be identifiable using disc ID where platform tools are available. |
| FR-071 | P1 | The system should query MusicBrainz for album, artist, track names, and release candidates. |
| FR-072 | P1 | The system should cache metadata responses locally. |
| FR-073 | P2 | The system should retrieve cover art where available. |
| FR-074 | P2 | DVDs should support manual naming if automatic metadata is unavailable. |
| FR-075 | P2 | DVDs may use optional external metadata providers in future versions. |
| FR-076 | P1 | Local MP3 files should expose embedded title, artist, album, track number, duration, and cover art where available. |
| FR-077 | P2 | Local media metadata should support manual edits and cached lookup results where enabled. |
| FR-078 | P1 | Local audio/video files should expose available container, codec, duration, resolution, bitrate, and embedded artwork/thumbnail metadata where available. |

### 8.10 Web UI

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-080 | P0 | The UI must be responsive for phone, iPad/tablet, desktop, and TV browser. |
| FR-081 | P0 | The UI must provide states for no drive, no disc, loading, error, CD, DVD, local media, and playback. |
| FR-082 | P0 | The UI must expose play, stop, and eject controls when available. |
| FR-083 | P0 | The UI must not require command-line knowledge. |
| FR-084 | P1 | The UI should expose diagnostics in a readable form. |
| FR-085 | P1 | The UI should support remote-control-friendly focus states. |
| FR-086 | P1 | The UI should show platform capability warnings. |
| FR-087 | P2 | The UI should support PWA installation. |
| FR-088 | P0 | The UI must expose configured local media sources without allowing unrestricted filesystem browsing. |

### 8.11 Installers and Diagnostics

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-090 | P0 | The repo must provide a top-level install entrypoint that detects Linux or macOS. |
| FR-091 | P0 | Linux installer must document required system packages. |
| FR-092 | P0 | macOS installer must document Homebrew dependencies. |
| FR-093 | P0 | Diagnostics must report platform, commands, encoders, drives, directories, and permission hints. |
| FR-094 | P1 | Linux service definition should use systemd. |
| FR-095 | P1 | macOS service definition should use launchd. |

---

## 9. Non-Functional Requirements

### 9.1 Performance

- API responses for status endpoints should normally return within 500 ms when not actively scanning hardware.
- The UI should show immediate loading states for operations that can take longer than 500 ms.
- CD audio playback should begin within 5 seconds on a healthy system.
- DVD HLS playback should expose the first playable playlist within 15 seconds on a capable host.
- Raspberry Pi DVD playback may use lower quality profiles to prioritize real-time playback.

### 9.2 Reliability

- External processes must be supervised and cleaned up.
- The app must tolerate disc removal during idle or playback.
- The app must tolerate browser disconnects.
- The app must not leave stale session state after FFmpeg exits.
- App restart should clear incomplete temporary stream directories.

### 9.3 Security

- Default binding should be local-network oriented and configurable.
- No internet exposure by default.
- No default cloud account, telemetry, or remote control.
- Mutating API endpoints should be protected by same-origin assumptions in MVP and prepared for token-based auth later.
- Future auth should support a simple local password or pairing token.
- API must validate all request bodies.
- User-provided labels and metadata must be escaped in UI.
- Local media APIs must reject path traversal and any file outside configured media roots.
- Normal API responses must avoid exposing absolute host filesystem paths.

### 9.4 Privacy

- Disc metadata and history are stored locally.
- Local media filenames, metadata, and playback history are stored locally.
- External metadata lookups should be optional and disclosed.
- No playback history is sent to external services unless the user enables a metadata integration that requires it.

### 9.5 Maintainability

- Core logic must not call platform-specific commands directly.
- Platform-specific logic must live behind typed adapters.
- API contracts should be shared between server and frontend.
- Command output parsers must have unit tests with fixtures.
- Streaming profile selection must be deterministic and testable.

### 9.6 Accessibility

- All controls must be keyboard accessible.
- UI must have visible focus states.
- Buttons must have accessible names.
- Playback controls must not rely on color alone.
- Text contrast must meet practical readability expectations in living room and mobile contexts.

### 9.7 Compatibility

- Server runtime should target a maintained Node.js LTS release.
- Frontend should work in current Chromium-based browsers, Safari, and Android TV browser environments where practical.
- HLS playback should support native HLS when available and hls.js when Media Source Extensions are available.

---

## 10. Architecture

### 10.1 High-Level Architecture

```text
Optical Drive                 Local Media Directories
    |                                  |
    v                                  v
Platform Adapter              Local Media Source Manager
    |                                  |
    v                                  v
Disc Inspection + Media Adapters + Local Media Inspection
                    |
                    v
Session Manager
    |
    v
Streaming Engine (FFmpeg + helpers)
    |
    v
HTTP API + WebSocket
    |
    v
Web UI
```

### 10.2 Runtime Components

- **Server App:** Node.js/TypeScript service using Fastify.
- **Web App:** React/TypeScript/Vite frontend served by the server in production.
- **Contracts Package:** Shared TypeScript types and schemas.
- **Platform Package:** Linux and macOS adapters.
- **Media Package:** Audio CD and DVD inspection logic.
- **Local Media Package:** Configured source roots, path validation, metadata probing, and local media item inspection.
- **Streaming Package:** FFmpeg command planning, session process control, HLS output handling.
- **Storage Package:** SQLite, filesystem cache paths, and optional local media index/cache state.
- **Diagnostics:** CLI and API-level diagnostics for setup and runtime issues.

### 10.3 Key Design Rule

The core application must never directly call platform-specific tools such as:

- `/dev/sr0`
- `lsblk`
- `udevadm`
- `udisksctl`
- `eject`
- `diskutil`
- `drutil`
- `ioreg`
- `systemd`
- `launchd`

All platform-specific behavior must pass through `PlatformAdapter`.

Local media filesystem access must pass through a source manager that validates all paths against configured roots before probing, streaming, or exposing metadata through the API.

---

## 11. Platform Abstraction

### 11.1 Supported Platforms

```ts
export type SupportedPlatform = "linux" | "darwin";
```

### 11.2 Platform Adapter Interface

```ts
export interface PlatformAdapter {
  readonly platform: SupportedPlatform;
  readonly displayName: string;

  detectCapabilities(): Promise<PlatformCapabilities>;
  detectOpticalDrives(): Promise<OpticalDrive[]>;
  getDriveStatus(driveId: string): Promise<DriveStatus>;

  inspectInsertedMedia(driveId: string): Promise<DiscInspection>;

  eject(driveId: string): Promise<void>;
  closeTray(driveId: string): Promise<void>;

  mount(driveId: string): Promise<MountedVolume | null>;
  unmount(driveId: string): Promise<void>;

  watchDrives(onEvent: (event: DriveEvent) => void): Promise<DriveWatcher>;
}
```

### 11.3 Linux Adapter

Likely tools and sources:

- `/sys/class/block`
- `/dev/sr*`
- `lsblk -J`
- `blkid`
- `udevadm`
- `udisksctl`
- `eject`
- `ffmpeg`
- `ffprobe`
- `cdparanoia` or `cd-info`
- `dvdbackup`, `lsdvd`, `mediainfo`, or FFmpeg probing where available

Linux behavior:

- Prefer explicit optical drive detection from `/sys/class/block`.
- Use `lsblk -J` for normalized device metadata when available.
- Use udev monitoring when available.
- Fall back to polling for MVP simplicity.
- Use `/var/lib/discstream`, `/var/cache/discstream`, `/var/log/discstream`, and `/etc/discstream` for service installs.
- In development mode, use local repo `runtime/` directories.

### 11.4 macOS Adapter

Likely tools and sources:

- `diskutil list -plist`
- `diskutil info -plist`
- `diskutil mount`
- `diskutil unmount`
- `drutil status`
- `drutil tray eject`
- `drutil tray close`
- `ioreg`
- `ffmpeg`
- `ffprobe`

macOS behavior:

- Use `diskutil` and `drutil` for drive and tray operations.
- Detect mounted DVD volumes under `/Volumes`.
- Use user-mode app directories by default:
  - Config: `~/Library/Application Support/DiscStream/config`
  - Data: `~/Library/Application Support/DiscStream/data`
  - Cache: `~/Library/Caches/DiscStream`
  - Logs: `~/Library/Logs/DiscStream`
- Prefer `h264_videotoolbox` for DVD transcoding when available.
- Fall back to `libx264`.

### 11.5 Normalized Models

```ts
export interface OpticalDrive {
  id: string;
  systemDevice: string;
  displayName: string;
  vendor?: string;
  model?: string;
  transport: "usb" | "sata" | "internal" | "unknown";
  capabilities: {
    audioCd: boolean;
    dvdVideo: boolean;
    eject: boolean;
    closeTray: boolean;
  };
}

export interface DriveStatus {
  driveId: string;
  status: "no-drive" | "empty" | "tray-open" | "media-present" | "busy" | "error";
  mediaPresent: boolean;
  trayOpen?: boolean;
  mountedVolume?: MountedVolume;
  error?: DiscStreamError;
}

export interface MountedVolume {
  mountPath: string;
  label?: string;
  filesystem?: string;
  readOnly?: boolean;
}
```

### 11.6 Platform Capabilities

```ts
export interface PlatformCapabilities {
  platform: SupportedPlatform;
  platformVersion?: string;
  architecture: string;
  isRaspberryPi?: boolean;

  commands: {
    ffmpeg: boolean;
    ffprobe: boolean;
    cdparanoia: boolean;
    cdInfo: boolean;
    discid: boolean;
    dvdbackup: boolean;
    lsdvd: boolean;
    eject: boolean;
    lsblk: boolean;
    udevadm: boolean;
    udisksctl: boolean;
    diskutil: boolean;
    drutil: boolean;
    ioreg: boolean;
  };

  videoEncoders: {
    libx264: boolean;
    h264VideoToolbox: boolean;
    h264V4l2m2m: boolean;
  };

  audioEncoders: {
    aac: boolean;
    libmp3lame: boolean;
    flac: boolean;
  };

  opticalDrives: number;

  paths: {
    configDir: string;
    dataDir: string;
    cacheDir: string;
    logDir: string;
    streamsDir: string;
  };
}
```

---

## 12. Media Model

DiscStream should model media sources explicitly so the same playback/session system can handle a physical disc, a local file, a local folder, or a readable disc image.

### 12.1 Disc Inspection

```ts
export type DiscType =
  | "none"
  | "audio-cd"
  | "dvd-video"
  | "data-disc"
  | "unknown";

export interface DiscInspection {
  driveId: string;
  type: DiscType;
  label?: string;
  mountedVolume?: MountedVolume;
  audioCd?: AudioCdDisc;
  dvdVideo?: DvdVideoDisc;
  warnings: DiscStreamWarning[];
  inspectedAt: string;
}
```

### 12.2 Audio CD Model

```ts
export interface AudioCdDisc {
  discId?: string;
  albumTitle?: string;
  albumArtist?: string;
  coverUrl?: string;
  durationSeconds?: number;
  tracks: AudioCdTrack[];
  metadataSource?: "none" | "musicbrainz" | "manual" | "cache";
}

export interface AudioCdTrack {
  number: number;
  title?: string;
  artist?: string;
  durationSeconds?: number;
}
```

### 12.3 DVD Model

```ts
export interface DvdVideoDisc {
  label?: string;
  mainTitleId?: number;
  titles: DvdTitle[];
  metadataSource?: "none" | "manual" | "cache";
}

export interface DvdTitle {
  id: number;
  durationSeconds?: number;
  chapters?: DvdChapter[];
  audioTracks?: DvdAudioTrack[];
  subtitleTracks?: DvdSubtitleTrack[];
  aspectRatio?: string;
}

export interface DvdChapter {
  number: number;
  startSeconds?: number;
  durationSeconds?: number;
}

export interface DvdAudioTrack {
  id: number;
  language?: string;
  codec?: string;
  channels?: string;
}

export interface DvdSubtitleTrack {
  id: number;
  language?: string;
  format?: string;
}
```

### 12.4 Local Media Model

```ts
export type MediaSourceKind =
  | "optical-disc"
  | "local-file"
  | "local-folder"
  | "disc-image";

export type LocalMediaType =
  | "audio-file"
  | "video-file"
  | "dvd-video-folder"
  | "cd-audio-image"
  | "dvd-image"
  | "unknown";

export interface LocalMediaRoot {
  id: string;
  displayName: string;
  enabled: boolean;
}

export interface LocalMediaItem {
  id: string;
  rootId: string;
  sourceKind: MediaSourceKind;
  mediaType: LocalMediaType;
  displayName: string;
  relativePath: string;
  mimeType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  audioFile?: LocalAudioFile;
  videoFile?: LocalVideoFile;
  dvdVideo?: DvdVideoDisc;
  warnings: DiscStreamWarning[];
  inspectedAt?: string;
}

export interface LocalAudioFile {
  format: "mp3" | "aac" | "m4a" | "flac" | "wav" | "ogg" | "opus" | "unknown";
  codec?: string;
  title?: string;
  artist?: string;
  albumTitle?: string;
  albumArtist?: string;
  trackNumber?: number;
  durationSeconds?: number;
  bitrateKbps?: number;
  coverUrl?: string;
}

export interface LocalVideoFile {
  container: "mp4" | "m4v" | "mov" | "mkv" | "webm" | "avi" | "mpeg" | "unknown";
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  bitrateKbps?: number;
  title?: string;
  thumbnailUrl?: string;
  directPlaySupported: boolean;
  transcodeRequired: boolean;
}
```

Local media APIs must expose stable item IDs and relative paths, not unrestricted absolute host filesystem paths. Diagnostics may show full paths only when useful for setup troubleshooting.

---

## 13. Streaming Pipeline

### 13.1 Streaming Principles

- Browser compatibility is more important than preserving original codec.
- Do not transcode unless needed.
- Avoid permanent copies by default.
- Keep streaming output under cache directories.
- Clean up aggressively.
- Prefer hardware acceleration when detected.
- Use conservative defaults on Raspberry Pi.

### 13.2 Audio CD Pipeline

Initial options:

```text
Audio CD
  -> cdparanoia/libcdio/cdda reader
  -> FFmpeg
  -> AAC or MP3
  -> HTTP audio stream or HLS
  -> HTML5 audio element
```

MVP recommendation:

- Start with progressive HTTP audio for a selected track.
- Add HLS audio later if needed for unified session handling.

Browser output candidates:

- AAC in MP4/M4A container.
- MP3 for broad compatibility.
- HLS audio for consistency with video sessions.

### 13.3 DVD Pipeline

```text
DVD-Video
  -> mounted VIDEO_TS or direct device input
  -> FFmpeg
  -> H.264 video + AAC audio
  -> HLS playlist and .ts/.m4s segments
  -> hls.js or native HLS
  -> HTML5 video element
```

DVD browser compatibility requires transcoding in most cases because DVD video commonly uses MPEG-2 and audio formats that browsers do not reliably play directly.

### 13.4 Local Media File Pipeline

Direct audio path:

```text
Local browser-compatible audio file
  -> metadata/probe step
  -> HTTP range-capable file stream
  -> HTML5 audio element
```

Transcoded audio path:

```text
Local audio file requiring conversion
  -> FFmpeg probe
  -> MP3/AAC stream or HLS audio
  -> HTML5 audio element
```

Direct video path:

```text
Local browser-compatible video file
  -> metadata/probe step
  -> HTTP range-capable file stream
  -> HTML5 video element
```

Transcoded video path:

```text
Local video file requiring conversion
  -> FFmpeg probe
  -> H.264 video + AAC audio
  -> HLS playlist and segments
  -> hls.js or native HLS
  -> HTML5 video element
```

Local DVD path:

```text
Local VIDEO_TS folder or readable DVD image
  -> FFmpeg/helper inspection
  -> H.264 video + AAC audio when needed
  -> HLS playlist and segments
  -> hls.js or native HLS
  -> HTML5 video element
```

Local CD image path:

```text
Local CD image or audio-file folder
  -> platform/helper reader when available
  -> direct MP3/AAC playback or FFmpeg transcode
  -> HTTP audio stream or HLS
  -> HTML5 audio element
```

Rules:

- Prefer direct playback for browser-compatible local files such as MP3, M4A/AAC, MP4, M4V, and WebM when the contained codecs are supported by the target browser.
- Use HTTP range requests for local files so browser seeking works where possible.
- Use FFmpeg/HLS for local DVD-style media and local audio/video files requiring transcoding.
- Treat container extension as a hint only; use FFprobe/metadata probing to determine actual codecs and direct-play eligibility.
- Never expose arbitrary filesystem browsing through the browser.
- Treat local media roots as explicit user configuration.

### 13.5 Streaming Profiles

```ts
export interface StreamingProfile {
  id: string;
  label: string;
  videoEncoder?: string;
  videoBitrate?: string;
  audioEncoder: string;
  audioBitrate: string;
  width?: number;
  height?: number;
  preset?: string;
  hardwareAccelerated: boolean;
  hlsSegmentSeconds: number;
  hlsListSize: number;
}
```

Profile selection:

1. If macOS and `h264_videotoolbox` is available:
   - Use `h264_videotoolbox`.
   - Target 480p/576p DVD source resolution where practical.
   - Bitrate around 2500k.
2. If Linux and `h264_v4l2m2m` is available:
   - Use `h264_v4l2m2m`.
   - Target source DVD resolution or reduced resolution.
   - Bitrate around 1800k.
3. If only `libx264` is available:
   - Use `libx264`.
   - On Raspberry Pi, use `ultrafast`, lower resolution, and lower bitrate.
   - On Mac, allow better software settings.
4. If no browser-compatible encoder is available:
   - Mark DVD streaming unavailable.
   - Show diagnostic guidance.

### 13.6 Session Lifecycle

```text
idle
  -> starting
  -> buffering
  -> playing
  -> stopping
  -> stopped

failure path:
starting/buffering/playing
  -> failed
  -> cleanup
  -> idle
```

Rules:

- Only one active session in MVP.
- Starting a new session while one exists should return `409 Conflict` unless an explicit `replace: true` flag is provided.
- Stop must terminate the external process.
- Stop must remove temporary stream files.
- Server restart must remove orphaned session directories.
- UI disconnect must not automatically stop playback in MVP.

---

## 14. API Requirements

The API should be versioned under `/api`.

### 14.1 Health

```http
GET /api/health
```

Response:

```json
{
  "ok": true,
  "version": "0.1.0",
  "startedAt": "2026-07-20T00:00:00.000Z"
}
```

### 14.2 Capabilities

```http
GET /api/capabilities
```

Returns `PlatformCapabilities`.

### 14.3 Drive List

```http
GET /api/drives
```

Response:

```json
{
  "drives": [
    {
      "id": "drive-0",
      "systemDevice": "/dev/sr0",
      "displayName": "USB Optical Drive",
      "transport": "usb",
      "capabilities": {
        "audioCd": true,
        "dvdVideo": true,
        "eject": true,
        "closeTray": false
      }
    }
  ]
}
```

### 14.4 Current Drive Status

```http
GET /api/drive
```

Response:

```json
{
  "driveId": "drive-0",
  "status": "media-present",
  "mediaPresent": true,
  "trayOpen": false
}
```

### 14.5 Eject

```http
POST /api/drive/eject
```

Response:

```json
{
  "ok": true
}
```

### 14.6 Close Tray

```http
POST /api/drive/close
```

Response:

```json
{
  "ok": true
}
```

If unsupported:

```json
{
  "error": {
    "code": "UNSUPPORTED_OPERATION",
    "message": "This drive or platform does not support closing the tray from software."
  }
}
```

### 14.7 Disc

```http
GET /api/disc
```

No disc:

```json
{
  "driveId": "drive-0",
  "type": "none",
  "warnings": [],
  "inspectedAt": "2026-07-20T00:00:00.000Z"
}
```

Audio CD:

```json
{
  "driveId": "drive-0",
  "type": "audio-cd",
  "audioCd": {
    "discId": "example-disc-id",
    "albumTitle": "Unknown Album",
    "albumArtist": "Unknown Artist",
    "tracks": [
      {
        "number": 1,
        "title": "Track 1",
        "durationSeconds": 185
      }
    ],
    "metadataSource": "none"
  },
  "warnings": [],
  "inspectedAt": "2026-07-20T00:00:00.000Z"
}
```

DVD:

```json
{
  "driveId": "drive-0",
  "type": "dvd-video",
  "label": "MOVIE_DISC",
  "dvdVideo": {
    "label": "MOVIE_DISC",
    "mainTitleId": 1,
    "titles": [
      {
        "id": 1,
        "durationSeconds": 7200,
        "chapters": [
          {
            "number": 1,
            "startSeconds": 0
          }
        ]
      }
    ],
    "metadataSource": "none"
  },
  "warnings": [],
  "inspectedAt": "2026-07-20T00:00:00.000Z"
}
```

### 14.8 Local Media

```http
GET /api/local-media
```

Returns configured local media roots and a shallow list of playable items:

```json
{
  "roots": [
    {
      "id": "local-root-1",
      "displayName": "Living Room Media",
      "enabled": true
    }
  ],
  "items": [
    {
      "id": "local-track-1",
      "rootId": "local-root-1",
      "sourceKind": "local-file",
      "mediaType": "audio-file",
      "displayName": "Track 01.mp3",
      "relativePath": "Music/Album/Track 01.mp3",
      "mimeType": "audio/mpeg",
      "audioFile": {
        "format": "mp3",
        "title": "Track 01",
        "artist": "Unknown Artist",
        "albumTitle": "Unknown Album"
      },
      "warnings": []
    },
    {
      "id": "local-video-1",
      "rootId": "local-root-1",
      "sourceKind": "local-file",
      "mediaType": "video-file",
      "displayName": "Home Movie.mp4",
      "relativePath": "Videos/Home Movie.mp4",
      "mimeType": "video/mp4",
      "videoFile": {
        "container": "mp4",
        "videoCodec": "h264",
        "audioCodec": "aac",
        "width": 1920,
        "height": 1080,
        "directPlaySupported": true,
        "transcodeRequired": false
      },
      "warnings": []
    },
    {
      "id": "local-dvd-1",
      "rootId": "local-root-1",
      "sourceKind": "local-folder",
      "mediaType": "dvd-video-folder",
      "displayName": "MOVIE_DISC",
      "relativePath": "DVDs/MOVIE_DISC/VIDEO_TS",
      "warnings": []
    }
  ]
}
```

```http
GET /api/local-media/:id
```

Returns a `LocalMediaItem` inspection result. Unsupported, unreadable, or out-of-root paths must return a structured error.

### 14.9 Create Session

```http
POST /api/sessions
Content-Type: application/json
```

Initial `mediaType` values:

- `audio-cd`
- `dvd-video`
- `local-audio`
- `local-video`
- `local-dvd-video`
- `local-cd-audio`

Audio CD request:

```json
{
  "mediaType": "audio-cd",
  "driveId": "drive-0",
  "track": 1,
  "replace": false
}
```

DVD request:

```json
{
  "mediaType": "dvd-video",
  "driveId": "drive-0",
  "title": 1,
  "chapter": 1,
  "audioTrack": null,
  "subtitleTrack": null,
  "replace": false
}
```

Local audio request:

```json
{
  "mediaType": "local-audio",
  "localMediaId": "local-track-1",
  "replace": false
}
```

Local video request:

```json
{
  "mediaType": "local-video",
  "localMediaId": "local-video-1",
  "replace": false
}
```

Local DVD folder request:

```json
{
  "mediaType": "local-dvd-video",
  "localMediaId": "local-dvd-1",
  "title": 1,
  "chapter": 1,
  "audioTrack": null,
  "subtitleTrack": null,
  "replace": false
}
```

Local CD image request:

```json
{
  "mediaType": "local-cd-audio",
  "localMediaId": "local-cd-image-1",
  "track": 1,
  "replace": false
}
```

Response:

```json
{
  "sessionId": "01J_DISCSTREAM_SESSION",
  "status": "starting",
  "streamUrl": "/streams/01J_DISCSTREAM_SESSION/master.m3u8",
  "mediaType": "dvd-video"
}
```

Session responses must include `driveId` for optical-disc sessions or `localMediaId` for local media sessions when applicable. The UI uses this to decide whether drive-specific actions such as eject should be shown.

### 14.10 Current Session

```http
GET /api/sessions/current
```

Response:

```json
{
  "sessionId": "01J_DISCSTREAM_SESSION",
  "status": "playing",
  "mediaType": "dvd-video",
  "streamUrl": "/streams/01J_DISCSTREAM_SESSION/master.m3u8",
  "startedAt": "2026-07-20T00:00:00.000Z"
}
```

### 14.11 Stop Session

```http
POST /api/sessions/current/stop
```

Response:

```json
{
  "ok": true,
  "status": "stopped"
}
```

### 14.12 Diagnostics

```http
GET /api/diagnostics
```

Returns:

- Platform capabilities.
- Drive list.
- Current drive status.
- Configured local media roots and access status.
- FFmpeg version.
- Encoder list summary.
- Writable directory status.
- Last session error.
- Human-readable setup warnings.

### 14.13 WebSocket Events

Endpoint:

```text
GET /api/events
```

Events:

```ts
type DiscStreamEvent =
  | { type: "capabilities.updated"; payload: PlatformCapabilities }
  | { type: "drive.updated"; payload: DriveStatus }
  | { type: "disc.updated"; payload: DiscInspection }
  | { type: "localMedia.updated"; payload: LocalMediaItem[] }
  | { type: "session.updated"; payload: PlaybackSession }
  | { type: "diagnostic.warning"; payload: DiscStreamWarning };
```

---

## 15. Web UI Requirements and Flows

### 15.1 UI Principles

- The first screen is the usable player, not a marketing landing page.
- The UI should feel like a media appliance.
- Controls should be large enough for TV and touch use.
- No visible technical jargon in the main player surface.
- Diagnostics may contain technical details, but should still include plain-language summaries.
- Local media browsing should show only configured sources, never a raw unrestricted filesystem picker.

### 15.2 Main States

#### No Drive

User sees:

- Product name.
- "No optical drive detected."
- Refresh/rescan control.
- Link/button to diagnostics.

Actions:

- Rescan drives.
- Open diagnostics.

#### No Disc

User sees:

- Detected drive name.
- "Insert a CD or DVD."
- Eject/close tray controls when available.

Actions:

- Eject.
- Close tray.
- Rescan.

#### Loading/Inspecting

User sees:

- Drive name.
- "Reading disc..."
- Non-blocking loading state.

Actions:

- Stop inspection if supported.
- Eject after inspection completes or fails.

#### Audio CD

User sees:

- Album art placeholder or cover art.
- Album title/artist when available.
- Track list.
- Play selected track.
- Previous/next.
- Stop.
- Eject.

Actions:

- Play track.
- Stop session.
- Select track.
- Eject.

#### DVD

User sees:

- DVD label or title placeholder.
- Main title selection.
- Play button.
- Chapters where available.
- Audio/subtitle selectors when available.
- Eject.

Actions:

- Play main title.
- Select title/chapter.
- Stop session.
- Eject.

#### Local Media

User sees:

- Configured local media source names.
- Available MP3 files and other supported audio items.
- Available local video files.
- Available DVD-Video folders or readable CD/DVD image candidates.
- Media title, folder name, or filename.
- Play button.
- Warnings for unsupported formats or unreadable files.

Actions:

- Select local media source.
- Play local MP3 or supported audio file.
- Play local video file through direct playback or transcoded HLS.
- Play local DVD-style media when supported.
- Stop session.
- Return to disc view.

#### Playback

User sees:

- Audio or video player.
- Current media title/track.
- Stop button.
- Playback progress where browser provides it.
- Session status.

Actions:

- Browser-native pause/play.
- Stop server session.
- Return to disc view.
- Eject after stopping when playing a physical disc.

### 15.3 Diagnostics UI

Diagnostics should include:

- Platform and architecture.
- App version.
- Drive detection.
- Local media root detection.
- FFmpeg availability.
- Encoder availability.
- CD tool availability.
- DVD tool availability.
- Directory permission status.
- Current warnings.
- Last failed command summary.

Diagnostics should distinguish:

- "Everything looks ready."
- "CD playback should work, DVD streaming may be slow."
- "FFmpeg is missing."
- "No optical drive detected."
- "The drive is visible but media cannot be inspected."
- "A local media folder is not accessible."
- "This local file format is not supported yet."

---

## 16. Project Structure

Recommended monorepo:

```text
discstream/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── api/
│   │   │   ├── app.ts
│   │   │   ├── config/
│   │   │   ├── diagnostics/
│   │   │   ├── sessions/
│   │   │   ├── storage/
│   │   │   └── main.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/
│       ├── src/
│       │   ├── api/
│       │   ├── app/
│       │   ├── components/
│       │   ├── player/
│       │   ├── routes/
│       │   └── styles/
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   │   ├── api.ts
│   │   │   ├── capabilities.ts
│   │   │   ├── disc.ts
│   │   │   ├── drive.ts
│   │   │   ├── errors.ts
│   │   │   ├── local-media.ts
│   │   │   └── session.ts
│   │   └── package.json
│   │
│   ├── platform/
│   │   ├── src/
│   │   │   ├── common/
│   │   │   ├── linux/
│   │   │   ├── macos/
│   │   │   ├── platform-adapter.ts
│   │   │   └── platform-factory.ts
│   │   └── package.json
│   │
│   ├── media/
│   │   ├── src/
│   │   │   ├── audio-cd/
│   │   │   ├── dvd/
│   │   │   └── media-inspector.ts
│   │   └── package.json
│   │
│   ├── local-media/
│   │   ├── src/
│   │   │   ├── local-media-source-manager.ts
│   │   │   ├── local-media-inspector.ts
│   │   │   ├── path-allowlist.ts
│   │   │   └── metadata-probe.ts
│   │   └── package.json
│   │
│   ├── streaming/
│   │   ├── src/
│   │   │   ├── ffmpeg/
│   │   │   ├── profiles/
│   │   │   ├── session-runner.ts
│   │   │   └── stream-planner.ts
│   │   └── package.json
│   │
│   └── shared/
│       ├── src/
│       └── package.json
│
├── scripts/
│   ├── install.sh
│   ├── install-linux.sh
│   ├── install-macos.sh
│   ├── diagnose.sh
│   └── test-drive.sh
│
├── packaging/
│   ├── systemd/
│   │   └── discstream.service
│   └── launchd/
│       └── com.discstream.server.plist
│
├── runtime/
│   ├── cache/
│   ├── covers/
│   ├── data/
│   ├── logs/
│   └── streams/
│
├── docs/
│   ├── architecture.md
│   ├── setup-linux.md
│   ├── setup-macos.md
│   └── troubleshooting.md
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

---

## 17. Technology Choices

### 17.1 Backend

- Node.js LTS
- TypeScript
- Fastify
- WebSocket support
- Zod or TypeBox for request/response schemas
- SQLite for local state
- Child process supervision for FFmpeg and platform commands

### 17.2 Frontend

- React
- TypeScript
- Vite
- hls.js
- CSS with a lightweight design system
- Optional future PWA support

### 17.3 External Tools

Linux:

- FFmpeg/FFprobe
- cdparanoia or libcdio utilities
- libdiscid-compatible utilities where available
- dvdbackup/lsdvd or equivalent DVD inspection tools where available
- lsblk
- udevadm
- udisksctl
- eject

macOS:

- FFmpeg/FFprobe from Homebrew
- libcdio/libdiscid/libdvdread/libdvdnav from Homebrew where needed
- diskutil
- drutil
- ioreg

---

## 18. Milestones

### Milestone 0: Repository Foundation

Deliverables:

- Monorepo scaffold.
- TypeScript config.
- Lint/test/build scripts.
- Shared contracts package.
- Basic server and web app.
- README with project overview.

Acceptance criteria:

- `pnpm install` succeeds on development machine.
- `pnpm dev` starts server and web app.
- `GET /api/health` returns a valid response.
- Web UI loads and shows app shell.

### Milestone 1: Platform and Capability Detection

Deliverables:

- Platform factory.
- Linux adapter skeleton.
- macOS adapter skeleton.
- Command detection.
- FFmpeg encoder detection.
- Runtime path detection.
- Diagnostics endpoint and page.

Acceptance criteria:

- `GET /api/capabilities` returns structured data on Linux and macOS.
- Missing commands appear as unavailable instead of crashing startup.
- UI diagnostics accurately reflects capability status.
- Unit tests cover encoder parser and command detection logic.

### Milestone 2: Drive Detection and Control

Deliverables:

- Linux optical drive detection.
- macOS optical drive detection.
- Normalized `OpticalDrive` model.
- Drive status endpoint.
- Eject endpoint.
- Basic polling or watch mechanism.
- UI no-drive/no-disc states.

Acceptance criteria:

- `GET /api/drives` returns detected drive list.
- `GET /api/drive` returns stable status.
- Eject works on at least one supported test system with compatible hardware.
- UI updates after rescan.
- Tests cover parsers for sample Linux and macOS command outputs.

### Milestone 3: Disc Detection

Deliverables:

- Audio CD detection path.
- DVD-Video detection path.
- Data/unknown fallback.
- Disc endpoint.
- UI disc states.

Acceptance criteria:

- Audio CD is recognized as `audio-cd` on at least one supported platform.
- DVD-Video is recognized as `dvd-video` on at least one supported platform.
- No disc returns `type: "none"`.
- Unknown or unreadable discs return structured warnings.
- UI displays useful state for each result.

### Milestone 4: Audio CD and Local MP3 Streaming MVP

Deliverables:

- Track selection model.
- Audio streaming process runner.
- Browser-compatible audio endpoint/session.
- Local media root configuration model.
- Local MP3 direct streaming endpoint/session.
- Start/stop session APIs.
- Audio player UI.

Acceptance criteria:

- User can start playback of track 1 from the web UI.
- User can start playback of a configured local MP3 file from the web UI.
- User can stop playback and server process exits.
- Repeated play/stop does not leave stale processes.
- Local MP3 playback does not expose files outside configured local media roots.
- Browser audio works on desktop browser and at least one mobile or TV-like browser.
- Failure cases show readable errors.

### Milestone 5: DVD HLS and Local Video Proof of Concept

Deliverables:

- DVD stream planner.
- FFmpeg HLS process runner.
- HLS output serving.
- Basic video player with hls.js.
- Capability-based encoder selection.
- Local video file direct-play path.
- Local video file HLS transcode path.
- Local DVD-Video folder input path.

Acceptance criteria:

- On a capable host, user can start DVD playback and view video in browser.
- User can start playback from a configured browser-compatible local video file.
- A readable non-direct-play local video file either transcodes to HLS or reports a clear capability warning.
- On a capable host, user can start playback from a configured local DVD-Video folder.
- HLS playlist and segments are generated under streams cache.
- Stop removes session output files.
- If encoder support is missing, UI shows a clear warning.
- Mac hardware acceleration is selected when available.

### Milestone 6: Productization

Deliverables:

- Install scripts.
- Linux systemd unit.
- macOS launchd plist.
- Logging.
- Better diagnostics.
- Error taxonomy.
- Initial configuration file.
- Local media root configuration documentation.

Acceptance criteria:

- Linux install instructions can produce a running service.
- macOS install instructions can produce a running service or LaunchAgent.
- Logs are written to the correct platform directory.
- Diagnostic output helps resolve missing FFmpeg, missing drive, local media root, and permission issues.

---

## 19. Acceptance Criteria for MVP

The MVP is accepted when:

- The app runs on at least one Linux machine and one macOS machine.
- The server detects the platform and reports capabilities.
- The server detects an optical drive when attached.
- The UI shows no-drive, no-disc, CD, DVD, local media, loading, and error states.
- The user can eject a compatible drive from the UI.
- The server can inspect at least one audio CD enough to expose playable tracks.
- The user can start and stop audio CD playback in a browser.
- The user can start and stop playback of at least one configured local MP3 file in a browser.
- Local media playback is restricted to configured local media roots.
- The server can attempt DVD HLS playback using FFmpeg and either:
  - successfully play on a capable host, or
  - report a clear capability or media-readability error.
- Active FFmpeg/helper processes are cleaned up when stopped.
- Temporary stream files are cleaned up when sessions stop.
- API responses are typed and validated.
- Core logic does not directly call OS-specific commands outside platform adapters.
- Basic unit tests and at least one browser smoke test are present.

---

## 20. Error Model

Errors should be structured:

```ts
export interface DiscStreamError {
  code: string;
  message: string;
  detail?: string;
  hint?: string;
  recoverable: boolean;
}
```

Initial error codes:

- `UNSUPPORTED_PLATFORM`
- `NO_OPTICAL_DRIVE`
- `DRIVE_BUSY`
- `NO_DISC`
- `UNKNOWN_DISC_TYPE`
- `DISC_INSPECTION_FAILED`
- `COMMAND_NOT_FOUND`
- `PERMISSION_DENIED`
- `UNSUPPORTED_OPERATION`
- `STREAM_PROFILE_UNAVAILABLE`
- `STREAM_START_FAILED`
- `STREAM_PROCESS_EXITED`
- `STREAM_TIMEOUT`
- `MEDIA_NOT_READABLE`
- `UNSUPPORTED_MEDIA_FORMAT`
- `LOCAL_MEDIA_ROOT_UNAVAILABLE`
- `MEDIA_PATH_NOT_ALLOWED`
- `VALIDATION_ERROR`

Warnings:

```ts
export interface DiscStreamWarning {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  hint?: string;
}
```

---

## 21. Configuration

Initial config:

```ts
export interface DiscStreamConfig {
  server: {
    host: string;
    port: number;
    publicBaseUrl?: string;
  };
  drives: {
    preferredDriveId?: string;
    pollingIntervalMs: number;
  };
  localMedia: {
    roots: Array<{
      id?: string;
      displayName: string;
      path: string;
      enabled: boolean;
    }>;
    scanOnStartup: boolean;
    includeExtensions: string[];
    exposeAbsolutePathsInDiagnostics: boolean;
  };
  streaming: {
    preferredProfile?: string;
    allowSoftwareTranscoding: boolean;
    cleanupOnStop: boolean;
    startupPlaylistTimeoutMs: number;
  };
  metadata: {
    enableExternalLookups: boolean;
    musicBrainzUserAgent?: string;
  };
  security: {
    requireAuth: boolean;
    authToken?: string;
  };
}
```

Default MVP config:

- Host: `0.0.0.0`
- Port: `7373`
- Polling interval: `2000 ms`
- Local media roots: `[]`
- Local media scan on startup: `false`
- Local media include extensions: `.mp3` for MVP; planned supported candidates include `.m4a`, `.aac`, `.flac`, `.wav`, `.ogg`, `.opus`, `.mp4`, `.m4v`, `.mov`, `.mkv`, `.webm`, `.avi`, `.mpeg`, `.mpg`, `.iso`, `.cue`, and `.bin`
- Expose absolute local media paths in diagnostics: `false`
- Allow software transcoding: `true`
- Cleanup on stop: `true`
- External metadata lookups: `false`
- Auth required: `false`

---

## 22. Storage

### 22.1 Filesystem

Use platform-specific paths in installed mode and repo-local paths in development mode.

Directories:

- `config`
- `data`
- `cache`
- `logs`
- `streams`
- `covers`

### 22.2 SQLite

Initial tables:

- `app_settings`
- `disc_cache`
- `metadata_cache`
- `local_media_roots`
- `local_media_items`
- `play_history`
- `sessions`

MVP may defer persistent tables except for settings, metadata cache, and configured local media roots if local MP3 playback is included.

---

## 23. Testing Strategy

### 23.1 Unit Tests

Focus areas:

- Platform detection.
- Command availability detection.
- FFmpeg encoder output parsing.
- Linux `lsblk` parser.
- macOS `diskutil` parser.
- Streaming profile selection.
- Local media path allowlist validation.
- Local MP3 metadata parsing/probing.
- Local audio/video codec and container probing.
- API request validation.
- Error mapping.

### 23.2 Integration Tests

Focus areas:

- Fastify route responses.
- Session manager with mocked process runner.
- Platform adapter with fixture command outputs.
- Local media source manager with temporary fixture directories.
- Stream file cleanup.
- WebSocket event broadcasting.

### 23.3 Browser Tests

Use Playwright for:

- App shell loads.
- No-drive state.
- No-disc state.
- Mock CD state and audio controls.
- Mock DVD state and video controls.
- Mock local media state and MP3 playback controls.
- Mock local video state and video playback controls.
- Diagnostics page.
- Responsive layout on mobile, iPad/tablet, desktop, and TV browser viewport sizes.
- TV mode focus and minimum control target sizes for remote-style navigation.

### 23.4 Hardware Tests

Manual test matrix:

| Host | Architecture | Drive | Media | Expected |
| --- | --- | --- | --- | --- |
| Raspberry Pi 3 | arm64/armhf | USB DVD | Audio CD | Track detection and playback |
| Raspberry Pi 3 | arm64/armhf | USB DVD | DVD-Video | Capability warning or low-quality HLS |
| Mac Mini Intel | x64 | USB DVD | Audio CD | Track detection and playback |
| Mac Mini Intel | x64 | USB DVD | DVD-Video | HLS playback with preferred encoder |
| Apple Silicon Mac | arm64 | USB DVD | Audio CD | Track detection and playback |
| Apple Silicon Mac | arm64 | USB DVD | DVD-Video | HLS playback with VideoToolbox when available |
| Any supported host | any | none required | Local MP3 | Direct browser playback |
| Any supported host | any | none required | Local MP4/H.264/AAC | Direct browser playback |
| Capable host | any | none required | Local MKV/MOV/AVI | HLS playback or readable capability warning |
| Capable host | any | none required | Local DVD-Video folder | HLS playback or readable capability warning |

Client browser targets:

- iPad Safari or Chromium-based iPad browser in portrait and landscape orientation.
- TV browser or Android TV browser with TV mode enabled.
- Desktop Chromium/Safari/Firefox-class browser.

### 23.5 Failure Testing

Cases:

- Start with no drive.
- Insert unreadable disc.
- Remove disc during inspection.
- Remove disc during streaming.
- Kill FFmpeg externally.
- Fill or lock stream cache directory.
- Missing FFmpeg.
- Missing eject/drutil command.
- Configured local media directory missing or unreadable.
- Local file outside configured media roots.
- Unsupported local file extension.
- Multiple browsers connected.
- Start session while session already active.

---

## 24. Risks and Mitigations

### 24.1 DVD Transcoding on Raspberry Pi 3

Risk:

- Raspberry Pi 3 may not transcode DVD video in real time.

Mitigation:

- Detect encoders.
- Use low-quality fallback.
- Warn clearly.
- Prioritize CD and Mac DVD experience for MVP.
- Add optional pre-buffer/cache later.

### 24.2 DVD Readability and Copy Protection

Risk:

- Some commercial DVDs may not be readable through normal tools.

Mitigation:

- Do not implement DRM bypass in MVP.
- Return clear `MEDIA_NOT_READABLE` or `DISC_INSPECTION_FAILED` errors.
- Document that DiscStream plays readable media and does not circumvent protections.

### 24.3 Platform Command Output Variability

Risk:

- `diskutil`, `drutil`, `lsblk`, and FFmpeg output differ across versions.

Mitigation:

- Prefer structured outputs such as plist/JSON.
- Maintain fixtures.
- Write parser tests.
- Keep parsing code isolated in adapters.

### 24.4 Browser HLS Differences

Risk:

- HLS support differs between Safari, Chromium, Android TV, and Mi Box browser.

Mitigation:

- Use native HLS when supported.
- Use hls.js where possible.
- Provide direct stream URL fallback for VLC/Kodi.

### 24.5 Optical Drive Hardware Differences

Risk:

- Some USB drives do not support software tray close or reliable status.

Mitigation:

- Model capabilities per drive.
- Hide unsupported controls.
- Provide manual refresh/rescan.

### 24.6 Long-Running External Processes

Risk:

- FFmpeg/helper processes may hang, fail, or continue after client disconnect.

Mitigation:

- Central process supervisor.
- Timeouts.
- Signal escalation.
- Cleanup on stop and startup.

### 24.7 Network Exposure

Risk:

- Binding to LAN can expose controls to other devices on the network.

Mitigation:

- Default to trusted LAN use with clear warning.
- Add optional auth before recommending internet exposure.
- Never expose externally by default.

### 24.8 Local Filesystem Exposure

Risk:

- Local media playback could accidentally expose unrelated host files if paths are accepted directly from the browser.

Mitigation:

- Require configured local media roots.
- Use opaque local media IDs in API requests.
- Validate resolved paths against allowlisted roots before probing or streaming.
- Avoid exposing absolute paths in normal API responses.

### 24.9 Local Media Format Variability

Risk:

- Local audio files, video files, DVD folders, and CD/DVD images may use formats, layouts, containers, or codecs that browsers and FFmpeg cannot handle consistently.

Mitigation:

- Start with MP3 direct playback as the simplest local file path.
- Prefer direct playback for browser-compatible MP4/WebM/audio files.
- Use FFprobe to classify container and codec instead of trusting file extensions.
- Use HLS transcoding for readable files that are not browser-compatible.
- Treat DVD folders and disc images as capability-dependent.
- Return clear `UNSUPPORTED_MEDIA_FORMAT` or `MEDIA_NOT_READABLE` errors.
- Add fixture-based tests for supported local media layouts.

---

## 25. Initial Backlog

### Epic A: Repo and Tooling

- Create monorepo scaffold.
- Add workspace package manager config.
- Add TypeScript base config.
- Add lint/test/build scripts.
- Add shared contracts package.
- Add README.

### Epic B: Server Foundation

- Create Fastify server.
- Add `/api/health`.
- Add config loader.
- Add runtime path resolver.
- Add structured error response handler.
- Add static serving for production web build.

### Epic C: Platform Abstraction

- Define `PlatformAdapter`.
- Define normalized drive/status/capability models.
- Implement platform factory.
- Implement command detector.
- Implement FFmpeg encoder detector.
- Add Linux adapter skeleton.
- Add macOS adapter skeleton.

### Epic D: Diagnostics

- Add `/api/capabilities`.
- Add `/api/diagnostics`.
- Add diagnostic warnings.
- Add CLI diagnostic script.
- Add UI diagnostics page.

### Epic E: Drive Detection

- Implement Linux optical drive discovery.
- Implement macOS optical drive discovery.
- Implement drive status.
- Implement eject.
- Implement close tray where available.
- Add drive polling/watch loop.
- Add drive WebSocket events.

### Epic F: Disc Detection

- Implement no-disc detection.
- Implement audio CD detection.
- Implement DVD-Video detection.
- Implement data/unknown fallback.
- Add `/api/disc`.
- Add disc WebSocket events.

### Epic G: Session Management

- Define playback session model.
- Implement session manager.
- Implement one-session policy.
- Implement session cleanup.
- Add `/api/sessions`.
- Add `/api/sessions/current`.
- Add `/api/sessions/current/stop`.
- Add session WebSocket events.

### Epic H: Local Media Sources

- Define local media root model.
- Implement local media path allowlist validation.
- Implement local media listing endpoint.
- Implement local MP3 metadata probing.
- Implement local MP3 direct streaming.
- Implement local audio/video metadata probing.
- Implement local browser-compatible video direct streaming.
- Implement local video HLS transcode planning for non-direct-play files.
- Add local DVD-Video folder inspection skeleton.
- Add local media UI state.

### Epic I: Audio CD Playback

- Create audio CD stream planner.
- Create audio process runner.
- Serve browser-compatible audio stream.
- Add track selection.
- Add audio player UI.
- Add stop/eject integration.

### Epic J: DVD HLS Playback

- Create DVD stream planner.
- Select streaming profile from capabilities.
- Start FFmpeg HLS process.
- Serve HLS playlists and segments.
- Add video player with hls.js.
- Add local DVD-Video folder input path.
- Add stream startup timeout handling.
- Add cleanup on stop/failure.

### Epic K: Web UI

- Create app shell.
- Add status data fetching.
- Add WebSocket client.
- Add no-drive state.
- Add no-disc state.
- Add CD state.
- Add DVD state.
- Add local media state.
- Add playback state.
- Add error and warning components.
- Add responsive layout.
- Add TV/browser focus states.

### Epic L: Packaging

- Add `scripts/install.sh`.
- Add Linux install script.
- Add macOS install script.
- Add Linux systemd service template.
- Add macOS launchd plist template.
- Add setup docs.

### Epic M: Tests

- Add unit test runner.
- Add parser fixtures.
- Add API route tests.
- Add session manager tests.
- Add local media path validation tests.
- Add local audio/video probing fixtures.
- Add local direct-play and transcode-planning tests.
- Add Playwright smoke tests.
- Add manual hardware test checklist.

---

## 26. Suggested First Codex Task Sequence

1. Scaffold the monorepo and base packages.
2. Implement server `/api/health`.
3. Implement contracts for capabilities, drives, discs, sessions, and errors.
4. Implement platform factory and capability detector.
5. Implement `/api/capabilities` and diagnostics page.
6. Implement drive detection skeletons with mock fallback.
7. Implement web UI states against mock data.
8. Implement local media root config and local MP3 playback with fixture files.
9. Add local audio/video probing and browser-compatible local video direct playback.
10. Add Linux/macOS real drive detection one platform at a time.
11. Add session manager with mocked process runner.
12. Add audio CD streaming MVP.
13. Add DVD HLS proof-of-concept.
14. Add local video HLS transcode proof-of-concept.
15. Add local DVD-Video folder proof-of-concept.

---

## 27. Open Questions

- Should the default app name remain DiscStream or use a Portuguese-facing name?
- Should the first implementation optimize for Mac Mini DVD playback or Raspberry Pi CD playback?
- Should external metadata lookup be disabled by default for privacy?
- Should the MVP include authentication, or remain trusted-LAN only?
- Which package manager should be used: pnpm, npm, or yarn?
- Should the first frontend be very minimal or visually polished from the beginning?
- Should the initial DVD input read from the mounted `VIDEO_TS` path or directly from the device?
- Which local audio/video formats should be prioritized after MP3 and MP4/H.264/AAC?
- What physical drive models should be used for the first hardware test matrix?

---

## 28. Definition of Done

A feature is done when:

- It is implemented behind the intended abstraction boundary.
- API contracts are typed and validated.
- UI has loading, success, and error states.
- Logs and diagnostics expose enough information to troubleshoot.
- Relevant unit/integration tests pass.
- Browser smoke tests pass when UI behavior is affected.
- Manual hardware behavior is documented if hardware is required.
- Temporary files and external processes are cleaned up.
- User-facing wording avoids unnecessary technical jargon.

---

## 29. MVP Success Metric

DiscStream MVP succeeds when a user can connect a USB CD/DVD drive to either a Mac Mini or Linux/Raspberry Pi host, configure an authorized local media folder, open the web UI from another device on the local network, see the inserted disc and local media states, play an audio CD track, play a local MP3 file, attempt DVD playback with clear capability handling, stop playback cleanly, and eject the disc without using the command line after setup.
