import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { makeError } from "@discstream/contracts";
import { findDvdTitleSets, resolveVideoTsPath, selectDvdTitleSet, type DvdTitleSet } from "@discstream/platform";
import { h264VideoEncoderArgs, type H264VideoEncoder, type RunningTranscode, type VideoQualityProfile } from "./local-video-transcoder.js";

export { findDvdTitleSets, resolveVideoTsPath, selectDvdTitleSet, type DvdTitleSet } from "@discstream/platform";

export interface DvdVideoTranscodeRequest {
  videoTsPath: string;
  outputDir: string;
  title?: number;
  startSeconds?: number | null;
  audioTrack?: number | null;
  subtitleTrack?: number | null;
  playlistName?: string;
  startupTimeoutMs?: number;
  videoEncoder?: H264VideoEncoder;
  videoQuality?: VideoQualityProfile;
}

export type DvdVideoTranscoder = (request: DvdVideoTranscodeRequest) => Promise<RunningTranscode>;

export const startDvdVideoHlsTranscode: DvdVideoTranscoder = async (request) => {
  const videoTsPath = await resolveVideoTsPath(request.videoTsPath);
  const titleSets = await findDvdTitleSets(videoTsPath);
  const titleSet = selectDvdTitleSet(titleSets, request.title);
  if (!titleSet) {
    throw makeError(
      "MEDIA_NOT_READABLE",
      request.title ? `DVD title ${request.title} was not found.` : "No playable DVD title VOBs were found.",
      {
        hint: "Check whether this DVD has a readable VIDEO_TS folder."
      }
    );
  }

  const playlistName = request.playlistName ?? "master.m3u8";
  const playlistPath = path.join(request.outputDir, playlistName);
  const segmentPattern = path.join(request.outputDir, "segment-%05d.ts");
  const concatPath = path.join(request.outputDir, `dvd-title-${titleSet.title}.ffconcat`);
  const sourceListPath = path.join(request.outputDir, `dvd-title-${titleSet.title}.sources.txt`);
  const stderrLogPath = path.join(request.outputDir, "ffmpeg.log");
  const subtitleTrack = typeof request.subtitleTrack === "number" ? request.subtitleTrack : undefined;

  await fs.rm(request.outputDir, { recursive: true, force: true });
  await fs.mkdir(request.outputDir, { recursive: true });
  await fs.writeFile(concatPath, buildDvdConcatFile(titleSet.files), "utf8");
  await fs.writeFile(sourceListPath, buildDvdSourceList(titleSet.files), "utf8");
  await fs.writeFile(stderrLogPath, "", "utf8");

  const child = spawn(
    "ffmpeg",
    buildDvdHlsArgs({
      concatPath,
      concatProtocolInput: subtitleTrack !== undefined ? buildDvdConcatProtocolInput(titleSet.files) : undefined,
      playlistPath,
      segmentPattern,
      startSeconds: request.startSeconds,
      audioTrack: request.audioTrack,
      subtitleTrack,
      videoEncoder: request.videoEncoder,
      videoQuality: request.videoQuality
    }),
    {
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  const stderr: string[] = [];
  const stopPlaylistMirror = startPlaylistMirror(playlistPath);
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

  try {
    await waitForDvdPlaylist(child, playlistPath, request.startupTimeoutMs ?? 20000, () => stderr.join("").slice(-2000));
  } catch (error) {
    await stopPlaylistMirror();
    throw error;
  }

  return {
    playlistPath,
    stop: async () => {
      await stopProcess(child);
      await stopPlaylistMirror();
    }
  };
};

export function buildDvdConcatFile(files: string[]): string {
  return ["ffconcat version 1.0", ...files.map((filePath) => `file '${escapeConcatPath(filePath)}'`), ""].join("\n");
}

export function buildDvdSourceList(files: string[]): string {
  return [...files, ""].join("\n");
}

export function buildDvdConcatProtocolInput(files: string[]): string {
  return `concat:${files.map(escapeConcatProtocolPath).join("|")}`;
}

export function buildDvdHlsArgs(request: {
  concatPath: string;
  concatProtocolInput?: string;
  playlistPath: string;
  segmentPattern: string;
  startSeconds?: number | null;
  audioTrack?: number | null;
  subtitleTrack?: number;
  videoEncoder?: H264VideoEncoder;
  videoQuality?: VideoQualityProfile;
}): string[] {
  const videoFilter = "yadif=0:-1:0,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p";
  const selectedAudio = typeof request.audioTrack === "number" ? request.audioTrack : undefined;
  const audioDisabled = request.audioTrack === null;
  const subtitleFilter =
    request.subtitleTrack !== undefined ? `[0:v:0][0:${request.subtitleTrack}]overlay,${videoFilter}[v]` : undefined;
  const seekArgs =
    typeof request.startSeconds === "number" && request.startSeconds > 0 ? ["-ss", formatFfmpegSeconds(request.startSeconds)] : [];
  const inputArgs = request.concatProtocolInput
    ? ["-i", request.concatProtocolInput]
    : ["-f", "concat", "-safe", "0", "-i", request.concatPath];

  return [
    "-hide_banner",
    "-y",
    "-fflags",
    "+genpts",
    "-probesize",
    "100M",
    "-analyzeduration",
    "100M",
    ...seekArgs,
    ...inputArgs,
    ...(subtitleFilter ? ["-filter_complex", subtitleFilter, "-map", "[v]"] : ["-map", "0:v:0", "-vf", videoFilter]),
    ...(audioDisabled ? ["-an"] : ["-map", selectedAudio !== undefined ? `0:${selectedAudio}` : "0:a:0?"]),
    "-sn",
    "-dn",
    ...h264VideoEncoderArgs(request.videoEncoder ?? "libx264", request.videoQuality ?? "balanced", "24"),
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
    ...(audioDisabled ? [] : ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]),
    "-max_muxing_queue_size",
    "1024",
    "-f",
    "hls",
    "-hls_time",
    "4",
    "-hls_list_size",
    "0",
    "-hls_flags",
    "independent_segments",
    "-hls_playlist_type",
    "event",
    "-hls_segment_type",
    "mpegts",
    "-hls_segment_filename",
    request.segmentPattern,
    request.playlistPath
  ];
}

async function waitForDvdPlaylist(
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
      throw makeError("STREAM_START_FAILED", "FFmpeg exited before the DVD playlist was ready.", {
        detail: stderrExcerpt(),
        hint: "Check whether FFmpeg can read this DVD's VOB files."
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await stopProcess(child);
  throw makeError("STREAM_TIMEOUT", "Timed out waiting for the DVD playlist.", {
    detail: stderrExcerpt(),
    hint: "DVD transcoding may be too slow on this host, or the title may not be readable."
  });
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

function startPlaylistMirror(playlistPath: string): () => Promise<void> {
  const tempPlaylistPath = `${playlistPath}.tmp`;
  const mirrorPath = `${playlistPath}.mirror`;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = () => {
    timer = setTimeout(() => {
      void sync().catch(() => undefined);
    }, 250);
  };

  const sync = async () => {
    if (stopped) {
      return;
    }

    await mirrorReadyPlaylist(tempPlaylistPath, mirrorPath, playlistPath);
    schedule();
  };

  schedule();

  return async () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    await mirrorReadyPlaylist(tempPlaylistPath, mirrorPath, playlistPath);
  };
}

async function mirrorReadyPlaylist(tempPlaylistPath: string, mirrorPath: string, playlistPath: string): Promise<void> {
  const playlist = await fs.readFile(tempPlaylistPath, "utf8").catch(() => null);
  if (!playlist || !isReadyHlsPlaylist(playlist)) {
    return;
  }

  await fs.writeFile(mirrorPath, playlist, "utf8");
  await fs.rename(mirrorPath, playlistPath);
}

function isReadyHlsPlaylist(playlist: string): boolean {
  const lines = playlist
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines[0] === "#EXTM3U" && playlist.includes("#EXTINF") && lines.some((line) => line.endsWith(".ts"));
}

function escapeConcatPath(filePath: string): string {
  return filePath.replaceAll("'", "'\\''");
}

function escapeConcatProtocolPath(filePath: string): string {
  return filePath.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

function formatFfmpegSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? seconds.toString() : seconds.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
