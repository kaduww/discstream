import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";
import { detectCommands } from "@discstream/platform";
import { makeError } from "@discstream/contracts";

const AUDIO_CD_READ_BLOCK_SIZE = "1048576";
const AUDIO_CD_INITIAL_HLS_BUFFER_SECONDS = 12;
const AUDIO_CD_HLS_STARTUP_TIMEOUT_MS = 30000;
const AUDIO_CD_HLS_SEGMENT_SECONDS = "2";

export interface AudioCdStreamRequest {
  devicePath: string;
  track: number;
  mountedVolumePath?: string;
  source?: AudioCdSource;
}

export type AudioCdSource =
  | {
      kind: "mounted-file";
      filePath: string;
      displayName?: string;
    }
  | {
      kind: "cdparanoia";
      devicePath: string;
      track: number;
    };

export interface RunningAudioCdStream {
  contentType: "audio/mpeg";
  stream: Readable;
  stop(): Promise<void>;
}

export interface AudioCdHlsTranscodeRequest {
  source: Extract<AudioCdSource, { kind: "mounted-file" }>;
  outputDir: string;
  playlistName?: string;
  startupTimeoutMs?: number;
  initialBufferSeconds?: number;
}

export interface RunningAudioCdHlsTranscode {
  playlistPath: string;
  stop(): Promise<void>;
}

export type AudioCdStreamer = (request: AudioCdStreamRequest) => Promise<RunningAudioCdStream>;
export type AudioCdFilePreparer = (source: Extract<AudioCdSource, { kind: "mounted-file" }>, outputPath: string) => Promise<void>;
export type AudioCdHlsTranscoder = (request: AudioCdHlsTranscodeRequest) => Promise<RunningAudioCdHlsTranscode>;

export async function startAudioCdStream(request: AudioCdStreamRequest): Promise<RunningAudioCdStream> {
  return startResolvedAudioCdStream(request.source ?? (await resolveAudioCdSource(request)));
}

export async function resolveAudioCdSource(request: AudioCdStreamRequest): Promise<AudioCdSource> {
  const commands = await detectCommands();
  if (!commands.ffmpeg) {
    throw makeError("COMMAND_NOT_FOUND", "FFmpeg is required for Audio CD playback.", {
      hint: "Install FFmpeg on the DiscStream server and try again."
    });
  }

  const mountedTrack = request.mountedVolumePath
    ? await findMountedAudioTrack(request.mountedVolumePath, request.track)
    : undefined;
  if (mountedTrack) {
    return {
      kind: "mounted-file",
      filePath: mountedTrack,
      displayName: path.basename(mountedTrack, path.extname(mountedTrack))
    };
  }

  if (!commands.cdparanoia) {
    throw makeError("COMMAND_NOT_FOUND", "Audio CD playback requires cdparanoia on this server.", {
      hint: "Install cdparanoia, or use local audio files until Audio CD support is configured."
    });
  }

  return {
    kind: "cdparanoia",
    devicePath: request.devicePath,
    track: request.track
  };
}

export async function startResolvedAudioCdStream(source: AudioCdSource): Promise<RunningAudioCdStream> {
  if (source.kind === "mounted-file") {
    return startFfmpegFromAudioFile(source.filePath);
  }

  return startCdparanoiaToMp3(source);
}

export function buildCdparanoiaArgs(request: AudioCdStreamRequest): string[] {
  return ["-d", request.devicePath, "-w", request.track.toString(), "-"];
}

export function buildFfmpegWavToMp3Args(): string[] {
  return ["-hide_banner", "-loglevel", "warning", "-f", "wav", "-i", "pipe:0", "-vn", "-codec:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1"];
}

export function buildFfmpegAudioFileToMp3Args(filePath: string): string[] {
  return ["-hide_banner", "-loglevel", "warning", "-i", filePath, "-vn", "-codec:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1"];
}

export function buildFfmpegPipedAudioFileToMp3Args(inputFormat: "aiff" | "wav"): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-f",
    inputFormat,
    "-i",
    "pipe:0",
    "-vn",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-f",
    "mp3",
    "pipe:1"
  ];
}

export function buildFfmpegAudioFileToMp3FileArgs(filePath: string, outputPath: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-y",
    "-i",
    filePath,
    "-vn",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-f",
    "mp3",
    outputPath
  ];
}

export function buildFfmpegAudioFileToHlsArgs(request: {
  filePath: string;
  playlistPath: string;
  segmentPattern: string;
}): string[] {
  return [
    "-hide_banner",
    "-y",
    "-i",
    request.filePath,
    "-vn",
    "-codec:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "event",
    "-hls_segment_type",
    "mpegts",
    "-hls_segment_filename",
    request.segmentPattern,
    request.playlistPath
  ];
}

export function buildFfmpegPipedAudioFileToHlsArgs(request: {
  inputFormat: "aiff" | "wav";
  playlistPath: string;
  segmentPattern: string;
}): string[] {
  return [
    "-hide_banner",
    "-y",
    "-f",
    request.inputFormat,
    "-i",
    "pipe:0",
    "-vn",
    "-codec:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-f",
    "hls",
    "-hls_time",
    AUDIO_CD_HLS_SEGMENT_SECONDS,
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "event",
    "-hls_segment_type",
    "mpegts",
    "-hls_segment_filename",
    request.segmentPattern,
    request.playlistPath
  ];
}

export const startAudioCdHlsTranscode: AudioCdHlsTranscoder = async (request) => {
  const playlistName = request.playlistName ?? "master.m3u8";
  const playlistPath = path.join(request.outputDir, playlistName);
  const segmentPattern = path.join(request.outputDir, "segment-%05d.ts");

  await fs.rm(request.outputDir, { recursive: true, force: true });
  await fs.mkdir(request.outputDir, { recursive: true });

  const reader = spawn("dd", [`if=${request.source.filePath}`, `bs=${AUDIO_CD_READ_BLOCK_SIZE}`], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  const child = spawn(
    "ffmpeg",
    buildFfmpegPipedAudioFileToHlsArgs({
      inputFormat: getPipedAudioFormat(request.source.filePath),
      playlistPath,
      segmentPattern
    }),
    {
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  const stderr: string[] = [];
  const appendStderr = (chunk: unknown) => {
    stderr.push(String(chunk));
    if (stderr.length > 40) {
      stderr.shift();
    }
  };

  reader.stdout.pipe(child.stdin);
  child.stdin.on("error", () => {
    // The pipe can close during normal stop/track end handling.
  });
  reader.on("error", (error) => {
    appendStderr(error.message);
    child.stdin.destroy(error);
  });

  for (const process of [reader, child]) {
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", appendStderr);
    process.on("error", (error) => {
      appendStderr(error.message);
    });
  }

  try {
    await waitForHlsPlaylist(
      child,
      playlistPath,
      request.startupTimeoutMs ?? AUDIO_CD_HLS_STARTUP_TIMEOUT_MS,
      () => stderr.join("").slice(-2000),
      request.initialBufferSeconds ?? AUDIO_CD_INITIAL_HLS_BUFFER_SECONDS
    );
  } catch (error) {
    await Promise.all([stopProcess(reader), stopProcess(child)]);
    throw error;
  }

  return {
    playlistPath,
    async stop() {
      await Promise.all([stopProcess(reader), stopProcess(child)]);
    }
  };
};

export function getHlsPlaylistBufferedSeconds(playlist: string): number {
  return [...playlist.matchAll(/^#EXTINF:([\d.]+)/gm)].reduce((total, match) => total + Number(match[1]), 0);
}

function getPipedAudioFormat(filePath: string): "aiff" | "wav" {
  return path.extname(filePath).toLowerCase() === ".wav" ? "wav" : "aiff";
}

export async function transcodeAudioFileToMp3File(
  source: Extract<AudioCdSource, { kind: "mounted-file" }>,
  outputPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const ffmpeg = spawn("ffmpeg", buildFfmpegAudioFileToMp3FileArgs(source.filePath, outputPath), {
    stdio: ["ignore", "ignore", "pipe"]
  });
  const stderrChunks: Buffer[] = [];
  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  const exitCode = await waitForExit(ffmpeg);
  if (exitCode !== 0) {
    throw makeError("STREAM_START_FAILED", "Audio CD track could not be prepared for smooth playback.", {
      detail: stderrText(stderrChunks) || `FFmpeg exited with code ${exitCode}.`,
      hint: "Check whether the mounted CD track is readable by FFmpeg."
    });
  }

  const stat = await fs.stat(outputPath).catch(() => null);
  if (!stat || stat.size === 0) {
    throw makeError("STREAM_START_FAILED", "Audio CD track produced an empty audio file.", {
      detail: stderrText(stderrChunks)
    });
  }
}

async function startFfmpegFromAudioFile(filePath: string): Promise<RunningAudioCdStream> {
  const reader = spawn("dd", [`if=${filePath}`, `bs=${AUDIO_CD_READ_BLOCK_SIZE}`], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  const ffmpeg = spawn("ffmpeg", buildFfmpegPipedAudioFileToMp3Args(getPipedAudioFormat(filePath)), {
    stdio: ["pipe", "pipe", "pipe"]
  });

  reader.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdin.on("error", () => {
    // The pipe can close during normal stop/track end handling.
  });
  reader.on("error", (error) => {
    ffmpeg.stdin.destroy(error);
  });

  return runningStream(ffmpeg, [reader, ffmpeg]);
}

async function startCdparanoiaToMp3(source: Extract<AudioCdSource, { kind: "cdparanoia" }>): Promise<RunningAudioCdStream> {
  const cdparanoia = spawn("cdparanoia", buildCdparanoiaArgs(source), {
    stdio: ["ignore", "pipe", "pipe"]
  });
  const ffmpeg = spawn("ffmpeg", buildFfmpegWavToMp3Args(), {
    stdio: ["pipe", "pipe", "pipe"]
  });

  cdparanoia.stdout.pipe(ffmpeg.stdin);
  cdparanoia.on("error", () => {
    ffmpeg.stdin.destroy();
  });

  return runningStream(ffmpeg, [cdparanoia, ffmpeg]);
}

async function runningStream(outputProcess: ChildProcess & { stdout: Readable }, processes: ChildProcess[]): Promise<RunningAudioCdStream> {
  const stderrChunks: Buffer[] = [];
  for (const process of processes) {
    process.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
  }

  try {
    const firstChunk = await waitForFirstAudioChunk(outputProcess, stderrChunks);
    const output = new PassThrough();
    output.write(firstChunk);
    outputProcess.stdout.pipe(output);

    output.once("close", () => {
      void Promise.all(processes.map(stopProcess));
    });

    return {
      contentType: "audio/mpeg",
      stream: output,
      async stop() {
        await Promise.all(processes.map(stopProcess));
      }
    };
  } catch (error) {
    await Promise.all(processes.map(stopProcess));
    throw error;
  }
}

function waitForFirstAudioChunk(outputProcess: ChildProcess & { stdout: Readable }, stderrChunks: Buffer[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        makeError("STREAM_TIMEOUT", "Audio CD stream did not start in time.", {
          detail: stderrText(stderrChunks),
          hint: "Try again, or check whether the CD track is readable by the server."
        })
      );
    }, 8000);

    const onData = (chunk: Buffer) => {
      cleanup();
      resolve(chunk);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(
        makeError("STREAM_START_FAILED", "Audio CD stream exited before audio started.", {
          detail: stderrText(stderrChunks) || `Process exited with code ${code ?? "unknown"}.`,
          hint: "Check whether FFmpeg can read the mounted CD track."
        })
      );
    };
    const onError = (error: Error) => {
      cleanup();
      reject(
        makeError("STREAM_START_FAILED", "Audio CD stream could not start.", {
          detail: error.message
        })
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      outputProcess.stdout.off("data", onData);
      outputProcess.off("exit", onExit);
      outputProcess.off("error", onError);
    };

    outputProcess.stdout.once("data", onData);
    outputProcess.once("exit", onExit);
    outputProcess.once("error", onError);
  });
}

function stderrText(chunks: Buffer[]): string | undefined {
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text || undefined;
}

function waitForExit(process: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    process.once("exit", (code) => {
      resolve(code);
    });
    process.once("error", reject);
  });
}

async function waitForHlsPlaylist(
  child: ChildProcess,
  playlistPath: string,
  timeoutMs: number,
  stderrExcerpt: () => string,
  initialBufferSeconds: number
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const playlist = await fs.readFile(playlistPath, "utf8");
      const bufferedSeconds = getHlsPlaylistBufferedSeconds(playlist);
      const hasSegments = playlist.includes(".ts");
      const hasCompleteShortTrack = playlist.includes("#EXT-X-ENDLIST") && bufferedSeconds > 0;
      if (hasSegments && (bufferedSeconds >= initialBufferSeconds || hasCompleteShortTrack)) {
        return;
      }
    } catch {
      // Playlist not ready yet.
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      throw makeError("STREAM_START_FAILED", "FFmpeg exited before the Audio CD HLS playlist was ready.", {
        detail: stderrExcerpt(),
        hint: "Check whether FFmpeg can read this mounted CD track."
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw makeError("STREAM_TIMEOUT", "Timed out waiting for the Audio CD HLS playlist.", {
    detail: stderrExcerpt(),
    hint: "Try again, or check whether the CD track is readable."
  });
}

function stopProcess(process: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (process.exitCode !== null || process.signalCode !== null || process.killed) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      process.kill("SIGKILL");
      resolve();
    }, 1200);

    process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    process.kill("SIGTERM");
  });
}

async function findMountedAudioTrack(mountPath: string, track: number): Promise<string | undefined> {
  let entries;
  try {
    entries = await fs.readdir(mountPath, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const audioFiles = entries
    .filter((entry) => entry.isFile() && [".aif", ".aiff", ".wav"].includes(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(mountPath, entry.name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  return audioFiles[track - 1];
}
