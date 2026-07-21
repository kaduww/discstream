import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  CreateSessionRequest,
  DiscInspection,
  DriveStatus,
  MountedVolume,
  OpticalDrive,
  PlatformCapabilities,
  PlaybackSession
} from "@discstream/contracts";
import { makeError } from "@discstream/contracts";
import type { LocalMediaSourceManager } from "@discstream/local-media";
import {
  resolveAudioCdSource,
  startAudioCdStream,
  type AudioCdFilePreparer,
  type AudioCdHlsTranscoder,
  type AudioCdSource,
  type AudioCdStreamer,
  type RunningAudioCdStream
} from "./audio-cd-streamer.js";
import { startDvdVideoHlsTranscode, type DvdVideoTranscoder } from "./dvd-video-transcoder.js";
import {
  startLocalVideoHlsTranscode,
  type H264VideoEncoder,
  type LocalVideoTranscoder,
  type RunningTranscode
} from "./local-video-transcoder.js";

export interface SessionManagerOptions {
  streamsDir: string;
  transcodeLocalVideo?: LocalVideoTranscoder;
  transcodeDvdVideo?: DvdVideoTranscoder;
  streamAudioCd?: AudioCdStreamer;
  prepareAudioCdFile?: AudioCdFilePreparer;
  transcodeAudioCdToHls?: AudioCdHlsTranscoder;
  detectCapabilities?: () => Promise<PlatformCapabilities>;
  detectOpticalDrives?: () => Promise<OpticalDrive[]>;
  getDriveStatus?: (driveId: string) => Promise<DriveStatus>;
  inspectDisc?: (driveId: string) => Promise<DiscInspection>;
}

export class SessionManager {
  private currentSession: PlaybackSession | null = null;
  private lastErrorValue: PlaybackSession["error"];
  private activeCleanup: (() => Promise<void>) | null = null;
  private audioCdRequest: { drive: OpticalDrive; disc: DiscInspection; track: number; source: AudioCdSource } | null = null;

  constructor(
    private readonly localMedia: LocalMediaSourceManager,
    private readonly options: SessionManagerOptions
  ) {}

  get current(): PlaybackSession | null {
    return this.currentSession;
  }

  get lastError(): PlaybackSession["error"] {
    return this.lastErrorValue;
  }

  async cleanupStaleStreams(): Promise<number> {
    await fs.mkdir(this.options.streamsDir, { recursive: true });
    const entries = await fs.readdir(this.options.streamsDir, { withFileTypes: true });
    let removed = 0;

    for (const entry of entries) {
      if (!entry.isDirectory() || !isSessionDirectoryName(entry.name)) {
        continue;
      }

      await fs.rm(path.join(this.options.streamsDir, entry.name), { recursive: true, force: true });
      removed += 1;
    }

    return removed;
  }

  async create(request: CreateSessionRequest): Promise<PlaybackSession> {
    if (this.currentSession && !["stopped", "failed"].includes(this.currentSession.status) && !request.replace) {
      throw makeError("DRIVE_BUSY", "A playback session is already active.", {
        hint: "Stop the current session or start again with replace enabled."
      });
    }

    if (this.currentSession && request.replace) {
      await this.stop();
    }

    try {
      if (request.mediaType === "local-audio" || request.mediaType === "local-video" || request.mediaType === "local-dvd-video") {
        return await this.createLocalSession(request);
      }

      if (request.mediaType === "audio-cd") {
        return await this.createAudioCdSession(request);
      }

      if (request.mediaType === "dvd-video") {
        return await this.createDvdVideoSession(request);
      }
    } catch (error) {
      this.lastErrorValue = isSessionError(error) ? error : undefined;
      throw error;
    }

    const error = makeError("STREAM_PROFILE_UNAVAILABLE", "This playback path is not implemented in the first development slice.", {
      hint: "Local MP3 and browser-compatible local video are available first; optical playback and HLS are next."
    });
    this.lastErrorValue = error;
    throw error;
  }

  async stop(): Promise<PlaybackSession> {
    if (!this.currentSession) {
      await this.runActiveCleanup();
      return {
        sessionId: "idle",
        status: "stopped",
        mediaType: "local-audio",
        stoppedAt: new Date().toISOString()
      };
    }

    const stoppedSession = {
      ...this.currentSession,
      status: "stopped",
      streamUrl: undefined,
      stoppedAt: new Date().toISOString()
    } satisfies PlaybackSession;

    await this.runActiveCleanup();
    this.currentSession = null;
    this.audioCdRequest = null;
    return stoppedSession;
  }

  async openAudioCdStream(sessionId: string): Promise<RunningAudioCdStream> {
    if (!this.currentSession || this.currentSession.sessionId !== sessionId || this.currentSession.mediaType !== "audio-cd") {
      throw makeError("MEDIA_NOT_READABLE", "No active Audio CD session is available.");
    }

    if (!this.audioCdRequest) {
      throw makeError("MEDIA_NOT_READABLE", "The active Audio CD session has no readable source.");
    }

    await this.runActiveCleanup();
    const running = await (this.options.streamAudioCd ?? startAudioCdStream)({
      devicePath: this.audioCdRequest.drive.systemDevice,
      track: this.audioCdRequest.track,
      mountedVolumePath: this.audioCdRequest.disc.mountedVolume?.mountPath,
      source: this.audioCdRequest.source
    });
    this.activeCleanup = running.stop;
    return running;
  }

  private async createLocalSession(request: CreateSessionRequest): Promise<PlaybackSession> {
    if (!request.localMediaId) {
      throw makeError("VALIDATION_ERROR", "Local media sessions require localMediaId.");
    }

    const resolved = await this.localMedia.resolveItemPath(request.localMediaId);
    if (!resolved) {
      throw makeError("MEDIA_NOT_READABLE", "This local media item is not available.", {
        hint: "Check the configured local media folder."
      });
    }

    const { item, absolutePath } = resolved;
    if (request.mediaType === "local-audio" && item.mediaType !== "audio-file") {
      throw makeError("VALIDATION_ERROR", "The selected local item is not an audio file.");
    }

    if (request.mediaType === "local-video" && item.mediaType !== "video-file") {
      throw makeError("VALIDATION_ERROR", "The selected local item is not a video file.");
    }

    if (request.mediaType === "local-dvd-video" && item.mediaType !== "dvd-video-folder") {
      throw makeError("VALIDATION_ERROR", "The selected local item is not a DVD-Video folder.");
    }

    if (request.mediaType === "local-video" && item.videoFile?.transcodeRequired) {
      return this.createLocalVideoHlsSession(request, item.displayName, absolutePath);
    }

    if (request.mediaType === "local-dvd-video") {
      return this.createLocalDvdVideoHlsSession(request, item.displayName, absolutePath);
    }

    const session: PlaybackSession = {
      sessionId: crypto.randomUUID(),
      status: "playing",
      mediaType: request.mediaType,
      localMediaId: item.id,
      startSeconds: request.startSeconds ?? undefined,
      displayName: item.displayName,
      streamUrl: `/api/local-media/${encodeURIComponent(item.id)}/stream`,
      startedAt: new Date().toISOString()
    };

    this.currentSession = session;
    return session;
  }

  private async createAudioCdSession(request: CreateSessionRequest): Promise<PlaybackSession> {
    const detectOpticalDrives = this.options.detectOpticalDrives;
    const inspectDisc = this.options.inspectDisc;
    if (!detectOpticalDrives || !inspectDisc) {
      throw makeError("STREAM_PROFILE_UNAVAILABLE", "Audio CD playback is not connected to a platform adapter yet.");
    }

    const drives = await detectOpticalDrives();
    const drive = request.driveId ? drives.find((item) => item.id === request.driveId) : drives[0];
    if (!drive) {
      throw makeError("NO_OPTICAL_DRIVE", "No optical drive is available for Audio CD playback.");
    }

    const disc = await inspectDisc(drive.id);
    if (disc.type === "none") {
      throw makeError("NO_DISC", "Insert an Audio CD before starting playback.");
    }

    if (disc.type !== "audio-cd") {
      throw makeError("UNSUPPORTED_MEDIA_FORMAT", "The inserted disc is not an Audio CD.", {
        hint: "Audio CD playback only works with discs detected as audio-cd."
      });
    }

    const track = request.track ?? 1;
    const source: AudioCdSource = this.options.streamAudioCd
      ? {
          kind: "cdparanoia",
          devicePath: drive.systemDevice,
          track
        }
      : await resolveAudioCdSource({
          devicePath: drive.systemDevice,
          track,
          mountedVolumePath: disc.mountedVolume?.mountPath
        });
    const sessionId = crypto.randomUUID();
    const audioCdStreamUrl =
      source.kind === "mounted-file"
        ? await this.resolveMountedAudioCdStreamUrl(sessionId, source)
        : this.audioCdApiStreamUrl(sessionId);
    const session: PlaybackSession = {
      sessionId,
      status: "playing",
      mediaType: "audio-cd",
      driveId: drive.id,
      track,
      startSeconds: request.startSeconds ?? undefined,
      displayName:
        disc.audioCd?.tracks.find((item) => item.number === track)?.title ??
        (source.kind === "mounted-file" && source.displayName ? source.displayName : `Audio CD - Track ${track}`),
      streamUrl: audioCdStreamUrl,
      startedAt: new Date().toISOString()
    };

    this.audioCdRequest = { drive, disc, track, source };
    this.currentSession = session;
    return session;
  }

  private async createDvdVideoSession(request: CreateSessionRequest): Promise<PlaybackSession> {
    const detectOpticalDrives = this.options.detectOpticalDrives;
    if (!detectOpticalDrives) {
      throw makeError("STREAM_PROFILE_UNAVAILABLE", "DVD playback is not connected to a platform adapter yet.");
    }

    const drives = await detectOpticalDrives();
    const drive = request.driveId ? drives.find((item) => item.id === request.driveId) : drives[0];
    if (!drive) {
      throw makeError("NO_OPTICAL_DRIVE", "No optical drive is available for DVD playback.");
    }

    const dvdSource = await this.resolveDvdPlaybackSource(drive.id);
    if (dvdSource.type === "none") {
      throw makeError("NO_DISC", "Insert a DVD before starting playback.");
    }

    if (dvdSource.type !== "dvd-video") {
      throw makeError("UNSUPPORTED_MEDIA_FORMAT", "The inserted disc is not a DVD-Video disc.", {
        hint: "DVD playback requires a mounted disc with a VIDEO_TS folder."
      });
    }

    if (!dvdSource.mountedVolume?.mountPath) {
      throw makeError("MEDIA_NOT_READABLE", "DVD playback requires a mounted DVD volume.", {
        hint: "Mount the DVD on the DiscStream server and try again."
      });
    }

    const sessionId = crypto.randomUUID();
    const outputDir = path.join(this.options.streamsDir, sessionId);
    const videoEncoder = await this.preferredH264VideoEncoder();
    const transcode = await (this.options.transcodeDvdVideo ?? startDvdVideoHlsTranscode)({
      videoTsPath: dvdSource.mountedVolume.mountPath,
      outputDir,
      title: request.title,
      startSeconds: request.startSeconds,
      audioTrack: request.audioTrack,
      subtitleTrack: request.subtitleTrack,
      videoEncoder,
      videoQuality: request.videoQuality ?? "balanced"
    });

    const session: PlaybackSession = {
      sessionId,
      status: "playing",
      mediaType: "dvd-video",
      driveId: drive.id,
      title: request.title,
      chapter: request.chapter,
      startSeconds: request.startSeconds ?? undefined,
      audioTrack: request.audioTrack,
      subtitleTrack: request.subtitleTrack,
      videoEncoder,
      videoQuality: request.videoQuality ?? "balanced",
      displayName: dvdDisplayName(dvdSource.label ?? "DVD-Video", request.title, request.chapter),
      streamUrl: `/streams/${encodeURIComponent(sessionId)}/${encodeURIComponent(path.basename(transcode.playlistPath))}`,
      startedAt: new Date().toISOString()
    };

    this.activeCleanup = () => cleanupTranscode(transcode, outputDir);
    this.currentSession = session;
    return session;
  }

  private async resolveDvdPlaybackSource(
    driveId: string
  ): Promise<{ type: "none" | "dvd-video" | "unsupported"; label?: string; mountedVolume?: MountedVolume }> {
    if (this.options.getDriveStatus) {
      const status = await this.options.getDriveStatus(driveId);
      if (!status.mediaPresent) {
        return { type: "none" };
      }

      if (status.mountedVolume?.mountPath) {
        return {
          type: "dvd-video",
          label: status.mountedVolume.label,
          mountedVolume: status.mountedVolume
        };
      }
    }

    if (!this.options.inspectDisc) {
      return { type: "unsupported" };
    }

    const disc = await this.options.inspectDisc(driveId);
    if (disc.type === "none") {
      return { type: "none" };
    }

    if (disc.type !== "dvd-video") {
      return { type: "unsupported" };
    }

    return {
      type: "dvd-video",
      label: disc.label ?? disc.dvdVideo?.label,
      mountedVolume: disc.mountedVolume
    };
  }

  private async resolveMountedAudioCdStreamUrl(
    sessionId: string,
    source: Extract<AudioCdSource, { kind: "mounted-file" }>
  ): Promise<string> {
    const outputDir = path.join(this.options.streamsDir, sessionId);
    if (this.options.prepareAudioCdFile) {
      const outputPath = path.join(outputDir, "track.mp3");
      await this.options.prepareAudioCdFile(source, outputPath);
      this.activeCleanup = async () => {
        await fs.rm(outputDir, { recursive: true, force: true });
      };
      return `/streams/${encodeURIComponent(sessionId)}/track.mp3`;
    }

    if (this.options.transcodeAudioCdToHls) {
      const transcode = await this.options.transcodeAudioCdToHls({
        source,
        outputDir
      });
      this.activeCleanup = () => cleanupTranscode(transcode, outputDir);
      return `/streams/${encodeURIComponent(sessionId)}/${encodeURIComponent(path.basename(transcode.playlistPath))}`;
    }

    return this.audioCdApiStreamUrl(sessionId);
  }

  private async createLocalVideoHlsSession(
    request: CreateSessionRequest,
    displayName: string,
    absolutePath: string
  ): Promise<PlaybackSession> {
    const sessionId = crypto.randomUUID();
    const outputDir = path.join(this.options.streamsDir, sessionId);
    const videoEncoder = await this.preferredH264VideoEncoder();
    const transcode = await (this.options.transcodeLocalVideo ?? startLocalVideoHlsTranscode)({
      inputPath: absolutePath,
      outputDir,
      startSeconds: request.startSeconds ?? undefined,
      videoEncoder,
      videoQuality: request.videoQuality ?? "balanced"
    });

    const session: PlaybackSession = {
      sessionId,
      status: "playing",
      mediaType: "local-video",
      localMediaId: request.localMediaId,
      startSeconds: request.startSeconds ?? undefined,
      videoEncoder,
      videoQuality: request.videoQuality ?? "balanced",
      displayName,
      streamUrl: `/streams/${encodeURIComponent(sessionId)}/master.m3u8`,
      startedAt: new Date().toISOString()
    };

    this.activeCleanup = () => cleanupTranscode(transcode, outputDir);
    this.currentSession = session;
    return session;
  }

  private async createLocalDvdVideoHlsSession(
    request: CreateSessionRequest,
    displayName: string,
    absolutePath: string
  ): Promise<PlaybackSession> {
    const sessionId = crypto.randomUUID();
    const outputDir = path.join(this.options.streamsDir, sessionId);
    const videoEncoder = await this.preferredH264VideoEncoder();
    const transcode = await (this.options.transcodeDvdVideo ?? startDvdVideoHlsTranscode)({
      videoTsPath: absolutePath,
      outputDir,
      title: request.title,
      startSeconds: request.startSeconds,
      audioTrack: request.audioTrack,
      subtitleTrack: request.subtitleTrack,
      videoEncoder,
      videoQuality: request.videoQuality ?? "balanced"
    });

    const session: PlaybackSession = {
      sessionId,
      status: "playing",
      mediaType: "local-dvd-video",
      localMediaId: request.localMediaId,
      title: request.title,
      chapter: request.chapter,
      startSeconds: request.startSeconds ?? undefined,
      audioTrack: request.audioTrack,
      subtitleTrack: request.subtitleTrack,
      videoEncoder,
      videoQuality: request.videoQuality ?? "balanced",
      displayName: dvdDisplayName(displayName, request.title, request.chapter),
      streamUrl: `/streams/${encodeURIComponent(sessionId)}/${encodeURIComponent(path.basename(transcode.playlistPath))}`,
      startedAt: new Date().toISOString()
    };

    this.activeCleanup = () => cleanupTranscode(transcode, outputDir);
    this.currentSession = session;
    return session;
  }

  private async runActiveCleanup(): Promise<void> {
    const cleanup = this.activeCleanup;
    this.activeCleanup = null;
    if (cleanup) {
      await cleanup();
    }
  }

  private audioCdApiStreamUrl(sessionId: string): string {
    return `/api/sessions/${encodeURIComponent(sessionId)}/audio`;
  }

  private async preferredH264VideoEncoder(): Promise<H264VideoEncoder> {
    if (!this.options.detectCapabilities) {
      return "libx264";
    }

    try {
      return selectH264VideoEncoder(await this.options.detectCapabilities());
    } catch {
      return "libx264";
    }
  }
}

async function cleanupTranscode(transcode: RunningTranscode, outputDir: string): Promise<void> {
  await transcode.stop();
  await fs.rm(outputDir, { recursive: true, force: true });
}

function isSessionError(error: unknown): error is PlaybackSession["error"] {
  return Boolean(error && typeof error === "object" && "code" in error && "message" in error);
}

function dvdDisplayName(baseName: string, title?: number, chapter?: number | null): string {
  return [baseName, title ? `Title ${title}` : undefined, chapter ? `Chapter ${chapter}` : undefined].filter(Boolean).join(" - ");
}

function isSessionDirectoryName(name: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name);
}

export function selectH264VideoEncoder(capabilities: PlatformCapabilities): H264VideoEncoder {
  if (capabilities.platform === "darwin" && capabilities.videoEncoders.h264VideoToolbox) {
    return "h264_videotoolbox";
  }

  if (capabilities.platform === "linux" && capabilities.videoEncoders.h264V4l2m2m) {
    return "h264_v4l2m2m";
  }

  if (capabilities.videoEncoders.libx264) {
    return "libx264";
  }

  if (capabilities.videoEncoders.h264VideoToolbox) {
    return "h264_videotoolbox";
  }

  if (capabilities.videoEncoders.h264V4l2m2m) {
    return "h264_v4l2m2m";
  }

  return "libx264";
}
