import path from "node:path";
import type { LocalAudioFile, LocalMediaItem, LocalMediaType, LocalVideoFile } from "@discstream/contracts";
import type { LocalMediaProbe } from "./ffprobe.js";

const audioExtensions = new Set([".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus"]);
const videoExtensions = new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".mpeg", ".mpg"]);
const discImageExtensions = new Set([".iso", ".cue", ".bin"]);

export function extensionFor(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

export function supportedExtensions(): string[] {
  return [...audioExtensions, ...videoExtensions, ...discImageExtensions].sort();
}

export function classifyLocalPath(filePath: string, isDirectory: boolean): LocalMediaType {
  const baseName = path.basename(filePath).toLowerCase();
  if (isDirectory && baseName === "video_ts") {
    return "dvd-video-folder";
  }

  const extension = extensionFor(filePath);
  if (audioExtensions.has(extension)) {
    return "audio-file";
  }

  if (videoExtensions.has(extension)) {
    return "video-file";
  }

  if (extension === ".iso") {
    return "dvd-image";
  }

  if (extension === ".cue" || extension === ".bin") {
    return "cd-audio-image";
  }

  return "unknown";
}

export function audioMetadataFor(filePath: string, probe?: LocalMediaProbe | null): LocalAudioFile | undefined {
  const extension = extensionFor(filePath);
  const format = extension.replace(".", "");

  if (!["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"].includes(format)) {
    return undefined;
  }

  return {
    format: format as LocalAudioFile["format"],
    codec: probe?.audioStream?.codec ?? (format === "m4a" ? "aac" : format),
    title: probe?.title ?? titleFromFilename(filePath),
    artist: probe?.artist,
    albumTitle: probe?.albumTitle,
    albumArtist: probe?.albumArtist,
    trackNumber: probe?.trackNumber,
    durationSeconds: probe?.durationSeconds ?? probe?.audioStream?.durationSeconds,
    bitrateKbps: probe?.audioStream?.bitrateKbps ?? probe?.bitrateKbps
  };
}

export function videoMetadataFor(filePath: string, probe?: LocalMediaProbe | null): LocalVideoFile | undefined {
  const extension = extensionFor(filePath);
  const container = containerFor(filePath, probe?.formatName);

  if (!["mp4", "m4v", "mov", "mkv", "webm", "avi", "mpeg"].includes(container)) {
    return undefined;
  }

  const videoCodec = normalizeCodec(probe?.videoStream?.codec);
  const audioCodec = normalizeCodec(probe?.audioStream?.codec);
  const directPlaySupported = isBrowserDirectVideo(container, videoCodec, audioCodec);

  return {
    container: container as LocalVideoFile["container"],
    videoCodec,
    audioCodec,
    width: probe?.videoStream?.width,
    height: probe?.videoStream?.height,
    durationSeconds: probe?.durationSeconds ?? probe?.videoStream?.durationSeconds,
    bitrateKbps: probe?.videoStream?.bitrateKbps ?? probe?.bitrateKbps,
    title: probe?.title ?? titleFromFilename(filePath),
    directPlaySupported,
    transcodeRequired: !directPlaySupported
  };
}

export function mimeTypeFor(item: Pick<LocalMediaItem, "mediaType" | "audioFile" | "videoFile">): string | undefined {
  if (item.mediaType === "audio-file") {
    switch (item.audioFile?.format) {
      case "mp3":
        return "audio/mpeg";
      case "m4a":
      case "aac":
        return "audio/aac";
      case "flac":
        return "audio/flac";
      case "wav":
        return "audio/wav";
      case "ogg":
      case "opus":
        return "audio/ogg";
      default:
        return undefined;
    }
  }

  if (item.mediaType === "video-file") {
    switch (item.videoFile?.container) {
      case "mp4":
      case "m4v":
        return "video/mp4";
      case "mov":
        return "video/quicktime";
      case "webm":
        return "video/webm";
      case "mpeg":
        return "video/mpeg";
      case "mkv":
        return "video/x-matroska";
      case "avi":
        return "video/x-msvideo";
      default:
        return undefined;
    }
  }

  return undefined;
}

function titleFromFilename(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).replace(/[_-]+/g, " ").trim();
}

function containerFor(filePath: string, formatName?: string): string {
  const extension = extensionFor(filePath);
  if (extension === ".mpg") {
    return "mpeg";
  }

  const extensionContainer = extension.replace(".", "");
  if (extensionContainer) {
    return extensionContainer;
  }

  const names = formatName?.split(",") ?? [];
  if (names.includes("matroska")) {
    return "mkv";
  }

  if (names.includes("mov") || names.includes("mp4")) {
    return "mp4";
  }

  if (names.includes("mpeg")) {
    return "mpeg";
  }

  return "unknown";
}

function normalizeCodec(codec: string | undefined): string | undefined {
  if (!codec) {
    return undefined;
  }

  if (codec === "avc1") {
    return "h264";
  }

  return codec.toLowerCase();
}

function isBrowserDirectVideo(container: string, videoCodec: string | undefined, audioCodec: string | undefined): boolean {
  const hasBrowserAudio = !audioCodec || ["aac", "mp3", "opus", "vorbis"].includes(audioCodec);

  if ((container === "mp4" || container === "m4v") && videoCodec === "h264" && hasBrowserAudio) {
    return true;
  }

  if (container === "webm" && ["vp8", "vp9", "av1"].includes(videoCodec ?? "") && hasBrowserAudio) {
    return true;
  }

  return false;
}
