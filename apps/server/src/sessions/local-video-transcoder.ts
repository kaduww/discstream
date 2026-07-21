import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { makeError } from "@discstream/contracts";

export interface LocalVideoTranscodeRequest {
  inputPath: string;
  outputDir: string;
  startSeconds?: number;
  playlistName?: string;
  startupTimeoutMs?: number;
  videoEncoder?: H264VideoEncoder;
  videoQuality?: VideoQualityProfile;
}

export type H264VideoEncoder = "libx264" | "h264_videotoolbox" | "h264_v4l2m2m";
export type VideoQualityProfile = "fast" | "balanced" | "quality";

export interface RunningTranscode {
  playlistPath: string;
  stop(): Promise<void>;
}

export type LocalVideoTranscoder = (request: LocalVideoTranscodeRequest) => Promise<RunningTranscode>;

export const startLocalVideoHlsTranscode: LocalVideoTranscoder = async (request) => {
  const playlistName = request.playlistName ?? "master.m3u8";
  const playlistPath = path.join(request.outputDir, playlistName);
  const segmentPattern = path.join(request.outputDir, "segment-%05d.ts");
  const stderrLogPath = path.join(request.outputDir, "ffmpeg.log");

  await fs.rm(request.outputDir, { recursive: true, force: true });
  await fs.mkdir(request.outputDir, { recursive: true });
  await fs.writeFile(stderrLogPath, "", "utf8");

  const child = spawn(
    "ffmpeg",
    buildLocalVideoHlsArgs({
      inputPath: request.inputPath,
      playlistPath,
      segmentPattern,
      startSeconds: request.startSeconds,
      videoEncoder: request.videoEncoder,
      videoQuality: request.videoQuality
    }),
    {
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  const stderr: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderr.push(text);
    void fs.appendFile(stderrLogPath, text).catch(() => undefined);
    if (stderr.length > 40) {
      stderr.shift();
    }
  });

  child.on("error", (error) => {
    stderr.push(error.message);
  });

  await waitForPlaylist(child, playlistPath, request.startupTimeoutMs ?? 15000, () => stderr.join("").slice(-2000));

  return {
    playlistPath,
    stop: () => stopProcess(child)
  };
};

export function buildLocalVideoHlsArgs(request: {
  inputPath: string;
  playlistPath: string;
  segmentPattern: string;
  startSeconds?: number;
  videoEncoder?: H264VideoEncoder;
  videoQuality?: VideoQualityProfile;
}): string[] {
  return [
    "-hide_banner",
    "-y",
    "-fflags",
    "+genpts",
    ...seekArgs(request.startSeconds),
    "-i",
    request.inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    ...h264VideoEncoderArgs(request.videoEncoder ?? "libx264", request.videoQuality ?? "balanced", "23"),
    "-profile:v",
    "main",
    "-level",
    "4.0",
    "-g",
    "48",
    "-keyint_min",
    "48",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-max_muxing_queue_size",
    "1024",
    "-f",
    "hls",
    "-hls_time",
    "4",
    "-hls_list_size",
    "0",
    "-hls_flags",
    "independent_segments+temp_file",
    "-hls_playlist_type",
    "event",
    "-hls_segment_type",
    "mpegts",
    "-hls_segment_filename",
    request.segmentPattern,
    request.playlistPath
  ];
}

export function h264VideoEncoderArgs(encoder: H264VideoEncoder, quality: VideoQualityProfile, balancedCrf: string): string[] {
  if (encoder === "h264_videotoolbox") {
    const bitrate = quality === "fast" ? "1800k" : quality === "quality" ? "4500k" : "2800k";
    const maxrate = quality === "fast" ? "2800k" : quality === "quality" ? "6500k" : "4200k";
    const bufsize = quality === "fast" ? "5600k" : quality === "quality" ? "13000k" : "8400k";
    return ["-c:v", "h264_videotoolbox", "-b:v", bitrate, "-maxrate", maxrate, "-bufsize", bufsize];
  }

  if (encoder === "h264_v4l2m2m") {
    const bitrate = quality === "fast" ? "1400k" : quality === "quality" ? "3500k" : "2200k";
    return ["-c:v", "h264_v4l2m2m", "-b:v", bitrate];
  }

  const preset = quality === "fast" ? "ultrafast" : quality === "quality" ? "medium" : "veryfast";
  const crf = quality === "fast" ? "28" : quality === "quality" ? "20" : balancedCrf;
  return ["-c:v", "libx264", "-preset", preset, "-crf", crf];
}

function seekArgs(startSeconds: number | undefined): string[] {
  return startSeconds && startSeconds > 0 ? ["-ss", startSeconds.toFixed(3)] : [];
}

async function waitForPlaylist(
  child: ChildProcess,
  playlistPath: string,
  timeoutMs: number,
  stderrExcerpt: () => string
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const playlist = await fs.readFile(playlistPath, "utf8");
      if (isReadyHlsPlaylist(playlist)) {
        return;
      }
    } catch {
      // Playlist not ready yet.
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      throw makeError("STREAM_START_FAILED", "FFmpeg exited before the HLS playlist was ready.", {
        detail: stderrExcerpt(),
        hint: "Check whether FFmpeg can read this video file."
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await stopProcess(child);
  throw makeError("STREAM_TIMEOUT", "Timed out waiting for a playable HLS playlist.", {
    detail: stderrExcerpt(),
    hint: "Try a smaller file or verify that FFmpeg is installed with H.264/AAC support."
  });
}

export function isReadyHlsPlaylist(playlist: string): boolean {
  const lines = playlist
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines[0] === "#EXTM3U" && playlist.includes("#EXTINF") && lines.some((line) => !line.startsWith("#") && line.endsWith(".ts"));
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 2000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
