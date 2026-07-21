import { execFile } from "node:child_process";

export interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  bit_rate?: string;
  tags?: Record<string, string>;
}

export interface FfprobeFormat {
  format_name?: string;
  duration?: string;
  bit_rate?: string;
  tags?: Record<string, string>;
}

export interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

export interface LocalMediaProbe {
  formatName?: string;
  durationSeconds?: number;
  bitrateKbps?: number;
  title?: string;
  artist?: string;
  albumTitle?: string;
  albumArtist?: string;
  trackNumber?: number;
  videoStream?: {
    codec?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
    bitrateKbps?: number;
  };
  audioStream?: {
    codec?: string;
    durationSeconds?: number;
    bitrateKbps?: number;
  };
}

export async function probeLocalMedia(filePath: string, timeoutMs = 2500): Promise<LocalMediaProbe | null> {
  const result = await runFfprobe(filePath, timeoutMs);
  if (!result) {
    return null;
  }

  return parseFfprobeJson(result);
}

export function parseFfprobeJson(input: FfprobeJson): LocalMediaProbe {
  const videoStream = input.streams?.find((stream) => stream.codec_type === "video");
  const audioStream = input.streams?.find((stream) => stream.codec_type === "audio");
  const formatTags = normalizeTags(input.format?.tags);
  const audioTags = normalizeTags(audioStream?.tags);
  const tags = { ...formatTags, ...audioTags };

  return {
    formatName: input.format?.format_name,
    durationSeconds: parseSeconds(input.format?.duration),
    bitrateKbps: parseBitrateKbps(input.format?.bit_rate),
    title: tags.title,
    artist: tags.artist,
    albumTitle: tags.album,
    albumArtist: tags.album_artist ?? tags.albumartist,
    trackNumber: parseTrackNumber(tags.track),
    videoStream: videoStream
      ? {
          codec: videoStream.codec_name,
          width: videoStream.width,
          height: videoStream.height,
          durationSeconds: parseSeconds(videoStream.duration),
          bitrateKbps: parseBitrateKbps(videoStream.bit_rate)
        }
      : undefined,
    audioStream: audioStream
      ? {
          codec: audioStream.codec_name,
          durationSeconds: parseSeconds(audioStream.duration),
          bitrateKbps: parseBitrateKbps(audioStream.bit_rate)
        }
      : undefined
  };
}

function runFfprobe(filePath: string, timeoutMs: number): Promise<FfprobeJson | null> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(stdout) as FfprobeJson);
        } catch {
          resolve(null);
        }
      }
    );
  });
}

function normalizeTags(tags: Record<string, string> | undefined): Record<string, string> {
  if (!tags) {
    return {};
  }

  return Object.fromEntries(Object.entries(tags).map(([key, value]) => [key.toLowerCase(), value]));
}

function parseSeconds(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseBitrateKbps(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed / 1000) : undefined;
}

function parseTrackNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value.split("/")[0] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
