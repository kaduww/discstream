import { runCommand } from "./process.js";

export interface ParsedFfmpegEncoders {
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
}

export const emptyEncoders: ParsedFfmpegEncoders = {
  videoEncoders: {
    libx264: false,
    h264VideoToolbox: false,
    h264V4l2m2m: false
  },
  audioEncoders: {
    aac: false,
    libmp3lame: false,
    flac: false
  }
};

export function parseFfmpegEncoders(output: string): ParsedFfmpegEncoders {
  const names = new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[1])
      .filter(Boolean)
  );

  return {
    videoEncoders: {
      libx264: names.has("libx264"),
      h264VideoToolbox: names.has("h264_videotoolbox"),
      h264V4l2m2m: names.has("h264_v4l2m2m")
    },
    audioEncoders: {
      aac: names.has("aac"),
      libmp3lame: names.has("libmp3lame"),
      flac: names.has("flac")
    }
  };
}

export async function detectFfmpegEncoders(ffmpegAvailable: boolean): Promise<ParsedFfmpegEncoders> {
  if (!ffmpegAvailable) {
    return emptyEncoders;
  }

  const result = await runCommand("ffmpeg", ["-hide_banner", "-encoders"], { timeoutMs: 4000 });
  if (result.code !== 0) {
    return emptyEncoders;
  }

  return parseFfmpegEncoders(result.stdout + "\n" + result.stderr);
}
