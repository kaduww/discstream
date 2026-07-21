import fsp from "node:fs/promises";
import path from "node:path";
import type {
  DiscInspection,
  DiscStreamWarning,
  DriveStatus,
  LocalMediaResponse,
  PlatformCapabilities
} from "@discstream/contracts";
import type { DiagnosticsResponse } from "@discstream/contracts";

const MAX_STREAM_CACHE_FILES_TO_SCAN = 5000;

export type StreamCacheDiagnostics = DiagnosticsResponse["runtime"]["streamCache"];

export async function inspectStreamCache(streamsDir: string): Promise<StreamCacheDiagnostics> {
  const summary: StreamCacheDiagnostics = {
    directoryCount: 0,
    fileCount: 0,
    ffmpegLogCount: 0,
    totalBytes: 0,
    scanLimited: false
  };
  const updatedTimes: number[] = [];

  let entries;
  try {
    entries = await fsp.readdir(streamsDir, { withFileTypes: true });
  } catch {
    return summary;
  }

  const directories = entries.filter((entry) => entry.isDirectory());
  summary.directoryCount = directories.length;

  for (const directory of directories) {
    await addDirectoryStats(path.join(streamsDir, directory.name), summary, updatedTimes);
    if (summary.scanLimited) {
      break;
    }
  }

  if (updatedTimes.length > 0) {
    summary.oldestUpdatedAt = new Date(Math.min(...updatedTimes)).toISOString();
    summary.newestUpdatedAt = new Date(Math.max(...updatedTimes)).toISOString();
  }

  return summary;
}

export function buildDiagnosticsWarnings(input: {
  capabilities: PlatformCapabilities;
  currentDrive: DriveStatus;
  disc: DiscInspection;
  localMedia: LocalMediaResponse;
  streamCache: StreamCacheDiagnostics;
  logFilePath?: string;
}): DiscStreamWarning[] {
  return [
    ...capabilityWarnings(input.capabilities),
    ...driveWarnings(input.currentDrive),
    ...input.disc.warnings,
    ...localMediaWarnings(input.localMedia),
    ...streamCacheWarnings(input.streamCache),
    ...loggingWarnings(input.logFilePath)
  ];
}

async function addDirectoryStats(directory: string, summary: StreamCacheDiagnostics, updatedTimes: number[]): Promise<void> {
  if (summary.scanLimited) {
    return;
  }

  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (summary.fileCount >= MAX_STREAM_CACHE_FILES_TO_SCAN) {
      summary.scanLimited = true;
      return;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await addDirectoryStats(entryPath, summary, updatedTimes);
      continue;
    }

    try {
      const stat = await fsp.stat(entryPath);
      summary.fileCount += 1;
      if (entry.name === "ffmpeg.log") {
        summary.ffmpegLogCount += 1;
      }
      summary.totalBytes += stat.size;
      updatedTimes.push(stat.mtimeMs);
    } catch {
      // Ignore files that disappear while diagnostics are running.
    }
  }
}

function capabilityWarnings(capabilities: PlatformCapabilities): DiscStreamWarning[] {
  const warnings: DiscStreamWarning[] = [];

  if (!capabilities.commands.ffmpeg) {
    warnings.push({
      code: "COMMAND_NOT_FOUND",
      message: "FFmpeg is not available.",
      severity: "error",
      hint: "Install FFmpeg so DVD, Audio CD preparation, and video transcoding can work."
    });
  }

  if (!capabilities.commands.ffprobe) {
    warnings.push({
      code: "COMMAND_NOT_FOUND",
      message: "FFprobe is not available.",
      severity: "warning",
      hint: "Install FFprobe with FFmpeg so DiscStream can inspect local audio and video details."
    });
  }

  if (!capabilities.videoEncoders.libx264 && !capabilities.videoEncoders.h264VideoToolbox && !capabilities.videoEncoders.h264V4l2m2m) {
    warnings.push({
      code: "STREAM_PROFILE_UNAVAILABLE",
      message: "No H.264 video encoder was detected.",
      severity: "error",
      hint: "Install an FFmpeg build with libx264 or a supported hardware encoder."
    });
  }

  return warnings;
}

function driveWarnings(currentDrive: DriveStatus): DiscStreamWarning[] {
  if (currentDrive.error) {
    return [
      {
        code: currentDrive.error.code,
        message: currentDrive.error.message,
        severity: currentDrive.error.code === "NO_OPTICAL_DRIVE" ? "info" : "warning",
        hint: currentDrive.error.hint
      }
    ];
  }

  if (currentDrive.status === "empty") {
    return [
      {
        code: "NO_DISC",
        message: "The optical drive is empty.",
        severity: "info",
        hint: "Insert an Audio CD or DVD, or play local media."
      }
    ];
  }

  return [];
}

function localMediaWarnings(localMedia: LocalMediaResponse): DiscStreamWarning[] {
  if (localMedia.roots.length === 0) {
    return [
      {
        code: "LOCAL_MEDIA_NOT_CONFIGURED",
        message: "No local media folders are configured.",
        severity: "info",
        hint: "Add a folder in Local sources to expose local files."
      }
    ];
  }

  if (localMedia.items.length === 0) {
    return [
      {
        code: "LOCAL_MEDIA_EMPTY",
        message: "Configured local media folders did not return playable items.",
        severity: "warning",
        hint: "Check folder permissions, supported extensions, and subfolder depth."
      }
    ];
  }

  return [];
}

function streamCacheWarnings(streamCache: StreamCacheDiagnostics): DiscStreamWarning[] {
  if (streamCache.scanLimited) {
    return [
      {
        code: "STREAM_CACHE_SCAN_LIMITED",
        message: "The stream cache is large enough that diagnostics stopped scanning early.",
        severity: "warning",
        hint: "Stop playback and restart DiscStream to clear stale stream folders."
      }
    ];
  }

  return [];
}

function loggingWarnings(logFilePath: string | undefined): DiscStreamWarning[] {
  if (logFilePath) {
    return [];
  }

  return [
    {
      code: "LOG_FILE_NOT_CONFIGURED",
      message: "File logging is not configured.",
      severity: "info",
      hint: "Set DISCSTREAM_LOG_FILE for installed mode so logs are written under the runtime logs folder."
    }
  ];
}
