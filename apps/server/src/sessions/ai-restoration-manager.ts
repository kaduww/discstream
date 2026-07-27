import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AiRestorationJob } from "@discstream/contracts";
import { findDvdTitleSets, resolveVideoTsPath, selectDvdTitleSet } from "@discstream/platform";
import { aiRestorationCachePaths, type AiRestorationCacheIdentity } from "./ai-restoration-cache.js";
import { buildDvdConcatFile } from "./dvd-video-transcoder.js";
import type { H264VideoEncoder } from "./local-video-transcoder.js";

export interface StartAiRestorationRequest {
  videoTsPath: string;
  sourceId: string;
  title: number;
  durationSeconds?: number;
  executable: string;
  chunkSeconds?: number;
  model?: "realesrgan-x4plus" | "realesr-animevideov3";
  audioTrack?: number;
  subtitleTrack?: number;
  videoEncoder?: H264VideoEncoder;
  aiBackend?: "realesrgan-ncnn-vulkan" | "realesrgan-pytorch-cuda";
  pythonExecutable?: string;
  fallbackExecutable?: string;
}

export class AiRestorationManager {
  private currentJob: AiRestorationJob | null = null;
  private activeProcess: ChildProcess | null = null;
  private cancelled = false;
  private statusBeforePause: AiRestorationJob["status"] | null = null;
  private activeDirectory: string | null = null;
  private readonly statePath: string;
  private activeLogPath: string | null = null;

  constructor(private readonly cacheDir: string) {
    this.statePath = path.join(cacheDir, "ai-restoration-current.json");
  }

  async initialize(): Promise<void> {
    try {
      const restored = JSON.parse(await fs.readFile(this.statePath, "utf8")) as AiRestorationJob;
      this.currentJob = ["queued", "extracting", "upscaling", "encoding", "paused"].includes(restored.status)
        ? { ...restored, status: "failed", message: "Restoration was interrupted by a server restart.", error: "Restart the restoration to resume from the cache." }
        : restored;
    } catch {
      this.currentJob = null;
    }
  }

  get current(): AiRestorationJob | null {
    return this.currentJob;
  }

  async start(request: StartAiRestorationRequest): Promise<AiRestorationJob> {
    if (this.currentJob && !["completed", "failed", "cancelled"].includes(this.currentJob.status)) {
      throw new Error("An AI restoration is already running.");
    }

    const videoTsPath = await resolveVideoTsPath(request.videoTsPath);
    const titleSet = selectDvdTitleSet(await findDvdTitleSets(videoTsPath), request.title);
    if (!titleSet) {
      throw new Error(`DVD title ${request.title} was not found.`);
    }

    const newestModifiedMs = Math.max(...(await Promise.all(titleSet.files.map((file) => fs.stat(file)))).map((stat) => stat.mtimeMs));
    const identity: AiRestorationCacheIdentity = {
      sourceId: `${request.sourceId}:audio:${request.audioTrack ?? "all"}:subtitle:${request.subtitleTrack ?? "off"}`,
      sourceSizeBytes: titleSet.sizeBytes,
      sourceModifiedMs: newestModifiedMs,
      scale: "2x",
      model: request.model ?? "realesrgan-x4plus"
    };
    const cachePaths = aiRestorationCachePaths(this.cacheDir, identity);
    const jobId = path.basename(cachePaths.directory);
    const streamUrl = `/restorations/${jobId}/restored.mp4`;

    if (await fileExists(cachePaths.outputPath)) {
      this.currentJob = {
        jobId,
        status: "completed",
        title: request.title,
        progress: 100,
        message: "Cached restoration is ready.",
        streamUrl,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
      return this.currentJob;
    }

    this.cancelled = false;
    this.activeDirectory = cachePaths.directory;
    this.activeLogPath = cachePaths.logPath;
    this.currentJob = {
      jobId,
      status: "queued",
      title: request.title,
      progress: 0,
      message: "Preparing restoration.",
      startedAt: new Date().toISOString()
    };
    await this.persist();
    void this.run(request, titleSet.files, cachePaths, streamUrl);
    return this.currentJob;
  }

  async cancel(): Promise<AiRestorationJob | null> {
    if (!this.currentJob || ["completed", "failed", "cancelled"].includes(this.currentJob.status)) {
      return this.currentJob;
    }
    this.cancelled = true;
    this.activeProcess?.kill("SIGTERM");
    this.currentJob = { ...this.currentJob, status: "cancelled", message: "Restoration cancelled." };
    await this.cleanupIntermediateFiles();
    await this.persist();
    return this.currentJob;
  }

  async pause(): Promise<AiRestorationJob | null> {
    if (!this.currentJob || ["completed", "failed", "cancelled", "paused"].includes(this.currentJob.status)) {
      return this.currentJob;
    }
    this.statusBeforePause = this.currentJob.status;
    this.activeProcess?.kill("SIGSTOP");
    this.currentJob = { ...this.currentJob, status: "paused", message: "Restoration paused." };
    await this.persist();
    return this.currentJob;
  }

  async resume(): Promise<AiRestorationJob | null> {
    if (!this.currentJob || this.currentJob.status !== "paused") {
      return this.currentJob;
    }
    this.activeProcess?.kill("SIGCONT");
    this.currentJob = {
      ...this.currentJob,
      status: this.statusBeforePause ?? "upscaling",
      message: "Restoration resumed."
    };
    this.statusBeforePause = null;
    await this.persist();
    return this.currentJob;
  }

  async deleteCached(jobId: string): Promise<void> {
    if (!/^[a-f0-9]{24}$/.test(jobId)) {
      throw new Error("Invalid restoration cache identifier.");
    }
    if (this.currentJob?.jobId === jobId && !["completed", "failed", "cancelled"].includes(this.currentJob.status)) {
      throw new Error("Cancel the active restoration before deleting it.");
    }
    await fs.rm(path.join(this.cacheDir, "ai-restorations", jobId), { recursive: true, force: true });
    if (this.currentJob?.jobId === jobId) {
      this.currentJob = null;
      await fs.rm(this.statePath, { force: true });
    }
  }

  private async run(
    request: StartAiRestorationRequest,
    sourceFiles: string[],
    cachePaths: ReturnType<typeof aiRestorationCachePaths>,
    streamUrl: string
  ): Promise<void> {
    const inputFrames = path.join(cachePaths.directory, "input-frames");
    const restoredFrames = path.join(cachePaths.directory, "restored-frames");
    const segmentsDir = path.join(cachePaths.directory, "segments");
    const concatPath = path.join(cachePaths.directory, "source.ffconcat");
    const segmentsConcatPath = path.join(cachePaths.directory, "segments.ffconcat");
    const restoredVideoPath = path.join(cachePaths.directory, "restored-video.mp4");
    const temporaryOutput = path.join(cachePaths.directory, "restored.tmp.mp4");
    const modelsPath = path.join(path.dirname(request.executable), "models");
    const model = request.model ?? "realesrgan-x4plus";

    try {
      await fs.mkdir(cachePaths.directory, { recursive: true });
      await fs.writeFile(concatPath, buildDvdConcatFile(sourceFiles), "utf8");
      const media = await probeDvdMedia(concatPath, request.durationSeconds, sourceFiles);
      const durationSeconds = request.durationSeconds ?? media.durationSeconds;
      const chunkSeconds = Math.max(10, request.chunkSeconds ?? 60);
      const totalChunks = Math.ceil(durationSeconds / chunkSeconds);
      this.currentJob = { ...(this.currentJob as AiRestorationJob), processedBlocks: 0, totalBlocks: totalChunks };
      await ensureRestorationDiskSpace(this.cacheDir, durationSeconds, media.frameRate, chunkSeconds);
      await fs.mkdir(segmentsDir, { recursive: true });

      for (let chunk = 0; chunk < totalChunks; chunk += 1) {
        this.assertNotCancelled();
        const segmentPath = path.join(segmentsDir, `segment-${String(chunk).padStart(5, "0")}.mp4`);
        if (await fileExists(segmentPath)) {
          this.currentJob = { ...(this.currentJob as AiRestorationJob), processedBlocks: chunk + 1, totalBlocks: totalChunks };
          this.update("upscaling", chunkProgress(chunk + 1, totalChunks), `Reusing restored block ${chunk + 1} of ${totalChunks}.`);
          continue;
        }
        await fs.rm(inputFrames, { recursive: true, force: true });
        await fs.rm(restoredFrames, { recursive: true, force: true });
        await fs.mkdir(inputFrames, { recursive: true });
        await fs.mkdir(restoredFrames, { recursive: true });
        const startSeconds = chunk * chunkSeconds;
        const currentDuration = Math.min(chunkSeconds, durationSeconds - startSeconds);

        this.update("extracting", chunkProgress(chunk, totalChunks), `Extracting block ${chunk + 1} of ${totalChunks}.`);
        await this.execute(
          "ffmpeg",
          buildFrameExtractionArgs(
            concatPath,
            path.join(inputFrames, "frame-%08d.jpg"),
            media.frameRate,
            startSeconds,
            currentDuration,
            request.subtitleTrack
          ),
          true
        );
        this.assertNotCancelled();

        this.update("upscaling", chunkProgress(chunk, totalChunks) + 1, `Restoring block ${chunk + 1} of ${totalChunks} with AI.`);
        if (request.aiBackend === "realesrgan-pytorch-cuda" && request.pythonExecutable) {
          try {
            await this.execute(request.pythonExecutable, [
              request.executable,
              "-i", inputFrames,
              "-o", restoredFrames,
              "-n", cudaModelName(model),
              "--outscale", "2",
              "--suffix", "out",
              "--ext", "jpg",
              "--tile", "256"
            ]);
            await normalizeCudaFrameNames(restoredFrames);
          } catch (error) {
            if (!request.fallbackExecutable) {
              throw error;
            }
            await fs.rm(restoredFrames, { recursive: true, force: true });
            await fs.mkdir(restoredFrames, { recursive: true });
            await this.execute(request.fallbackExecutable, [
              "-i", inputFrames,
              "-o", restoredFrames,
              "-m", path.join(path.dirname(request.fallbackExecutable), "models"),
              "-n", model,
              "-s", "2",
              "-f", "jpg"
            ]);
          }
        } else {
          await this.execute(request.executable, [
            "-i", inputFrames,
            "-o", restoredFrames,
            "-m", modelsPath,
            "-n", model,
            "-s", "2",
            "-f", "jpg"
          ]);
        }
        this.assertNotCancelled();

        await this.execute(
          "ffmpeg",
          buildRestoredSegmentArgs(restoredFrames, segmentPath, media.frameRate, request.videoEncoder),
          true
        );
        await this.cleanupIntermediateFiles();
        this.currentJob = { ...(this.currentJob as AiRestorationJob), processedBlocks: chunk + 1, totalBlocks: totalChunks };
        this.update("upscaling", chunkProgress(chunk + 1, totalChunks), `Completed block ${chunk + 1} of ${totalChunks}.`);
      }

      const segmentFiles = Array.from({ length: totalChunks }, (_, chunk) =>
        path.join(segmentsDir, `segment-${String(chunk).padStart(5, "0")}.mp4`)
      );
      await fs.writeFile(segmentsConcatPath, buildDvdConcatFile(segmentFiles), "utf8");
      this.update("encoding", 92, "Joining restored blocks.");
      await this.execute("ffmpeg", buildSegmentJoinArgs(segmentsConcatPath, restoredVideoPath), true);
      this.update("encoding", 96, "Restoring audio, chapters and metadata.");
      await this.execute("ffmpeg", buildFinalMuxArgs(restoredVideoPath, concatPath, temporaryOutput, request.audioTrack), true);
      this.assertNotCancelled();
      await fs.rename(temporaryOutput, cachePaths.outputPath);
      await fs.writeFile(cachePaths.manifestPath, JSON.stringify({
        model,
        scale: "2x",
        title: request.title,
        durationSeconds: request.durationSeconds,
        completedAt: new Date().toISOString()
      }, null, 2));
      await fs.rm(inputFrames, { recursive: true, force: true });
      await fs.rm(restoredFrames, { recursive: true, force: true });
      await fs.rm(segmentsDir, { recursive: true, force: true });
      await fs.rm(restoredVideoPath, { force: true });

      this.currentJob = {
        ...(this.currentJob as AiRestorationJob),
        status: "completed",
        progress: 100,
        message: "AI restoration is ready.",
        streamUrl,
        completedAt: new Date().toISOString()
      };
      await this.persist();
    } catch (error) {
      if (this.cancelled) {
        return;
      }
      this.currentJob = {
        ...(this.currentJob as AiRestorationJob),
        status: "failed",
        message: "AI restoration failed.",
        error: error instanceof Error ? error.message : String(error)
      };
      await this.cleanupIntermediateFiles();
      await this.persist();
    } finally {
      this.activeProcess = null;
      this.activeDirectory = null;
      this.activeLogPath = null;
    }
  }

  private update(status: AiRestorationJob["status"], progress: number, message: string): void {
    const current = this.currentJob as AiRestorationJob;
    const elapsedSeconds = Math.max(1, (Date.now() - new Date(current.startedAt).getTime()) / 1000);
    const etaSeconds = progress > 0 && progress < 100 ? Math.round((elapsedSeconds / progress) * (100 - progress)) : undefined;
    this.currentJob = { ...current, status, progress, message, etaSeconds };
    void this.persist();
  }

  private execute(command: string, args: string[], ffmpeg = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const finalArgs = ffmpeg ? ["-hide_banner", "-y", ...args] : args;
      if (this.activeLogPath) {
        void fs.appendFile(this.activeLogPath, `\n$ ${command} ${finalArgs.join(" ")}\n`, "utf8");
      }
      const child = spawn(command, finalArgs, { stdio: ["ignore", "ignore", "pipe"] });
      this.activeProcess = child;
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderr = `${stderr}${text}`.slice(-4000);
        if (this.activeLogPath) {
          void fs.appendFile(this.activeLogPath, text, "utf8");
        }
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        this.activeProcess = null;
        if (this.cancelled) {
          reject(new Error("Restoration cancelled."));
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with ${signal ?? code}: ${stderr}`));
        }
      });
    });
  }

  private assertNotCancelled(): void {
    if (this.cancelled) {
      throw new Error("Restoration cancelled.");
    }
  }

  private async persist(): Promise<void> {
    if (!this.currentJob) {
      return;
    }
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(this.statePath, JSON.stringify(this.currentJob, null, 2), "utf8");
  }

  private async cleanupIntermediateFiles(): Promise<void> {
    if (!this.activeDirectory) {
      return;
    }
    await Promise.all([
      fs.rm(path.join(this.activeDirectory, "input-frames"), { recursive: true, force: true }),
      fs.rm(path.join(this.activeDirectory, "restored-frames"), { recursive: true, force: true }),
      fs.rm(path.join(this.activeDirectory, "restored.tmp.mp4"), { force: true })
    ]);
  }
}

function cudaModelName(model: StartAiRestorationRequest["model"]): string {
  return model === "realesr-animevideov3" ? "realesr-animevideov3" : "RealESRGAN_x4plus";
}

async function normalizeCudaFrameNames(directory: string): Promise<void> {
  const entries = await fs.readdir(directory);
  await Promise.all(
    entries
      .filter((name) => /_out\.(jpg|jpeg)$/i.test(name))
      .map((name) => fs.rename(path.join(directory, name), path.join(directory, name.replace(/_out(?=\.(jpg|jpeg)$)/i, ""))))
  );
}

export function buildFrameExtractionArgs(
  concatPath: string,
  framePattern: string,
  frameRate = "30000/1001",
  startSeconds?: number,
  durationSeconds?: number,
  subtitleTrack?: number
): string[] {
  const videoFilter = `yadif=0:-1:0,fps=${frameRate},scale=trunc(iw*sar/2)*2:trunc(ih/2)*2:flags=lanczos,setsar=1`;
  return [
    "-f", "concat", "-safe", "0", "-i", concatPath,
    ...(startSeconds !== undefined ? ["-ss", startSeconds.toFixed(3)] : []),
    ...(durationSeconds !== undefined ? ["-t", durationSeconds.toFixed(3)] : []),
    ...(subtitleTrack !== undefined
      ? ["-filter_complex", `[0:v:0][0:${subtitleTrack}]overlay,${videoFilter}[v]`, "-map", "[v]"]
      : ["-vf", videoFilter]),
    "-q:v", "2",
    framePattern
  ];
}

export function buildRestoredSegmentArgs(
  restoredFrames: string,
  outputPath: string,
  frameRate = "30000/1001",
  videoEncoder: H264VideoEncoder = "libx264"
): string[] {
  return [
    "-framerate", frameRate, "-i", path.join(restoredFrames, "frame-%08d.jpg"),
    "-map", "0:v:0", "-an",
    ...restorationVideoEncoderArgs(videoEncoder),
    "-pix_fmt", "yuv420p",
    outputPath
  ];
}

export function restorationVideoEncoderArgs(videoEncoder: H264VideoEncoder): string[] {
  if (videoEncoder === "h264_nvenc") {
    return ["-c:v", "h264_nvenc", "-preset", "p6", "-tune", "hq", "-rc", "vbr", "-cq", "19", "-b:v", "0"];
  }
  if (videoEncoder === "h264_videotoolbox") {
    return ["-c:v", "h264_videotoolbox", "-b:v", "8000k", "-maxrate", "12000k", "-bufsize", "24000k"];
  }
  if (videoEncoder === "h264_v4l2m2m") {
    return ["-c:v", "h264_v4l2m2m", "-b:v", "8000k"];
  }
  return ["-c:v", "libx264", "-preset", "medium", "-crf", "18"];
}

export function buildSegmentJoinArgs(segmentsConcatPath: string, outputPath: string): string[] {
  return ["-f", "concat", "-safe", "0", "-i", segmentsConcatPath, "-map", "0:v:0", "-c", "copy", outputPath];
}

export function buildFinalMuxArgs(restoredVideoPath: string, sourceConcatPath: string, outputPath: string, audioTrack?: number): string[] {
  return [
    "-i", restoredVideoPath,
    "-f", "concat", "-safe", "0", "-i", sourceConcatPath,
    "-map", "0:v:0", "-map", audioTrack !== undefined ? `1:${audioTrack}` : "1:a?",
    "-map_metadata", "1", "-map_chapters", "1",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", "-shortest",
    outputPath
  ];
}

export interface DvdMediaTiming {
  frameRate: string;
  durationSeconds: number;
}

export async function probeDvdMedia(
  concatPath: string,
  fallbackDurationSeconds?: number,
  sourceFiles: string[] = []
): Promise<DvdMediaTiming> {
  const output = await captureProcess("ffprobe", [
    "-v", "error",
    "-f", "concat", "-safe", "0", "-i", concatPath,
    "-select_streams", "v:0",
    "-show_entries", "stream=avg_frame_rate:format=duration",
    "-of", "json"
  ]);
  const parsed = JSON.parse(output) as { streams?: Array<{ avg_frame_rate?: string }>; format?: { duration?: string } };
  const frameRate = normalizedFrameRate(parsed.streams?.[0]?.avg_frame_rate);
  const probedDurationSeconds = Number(parsed.format?.duration);
  const durationSeconds =
    positiveNumber(fallbackDurationSeconds) ??
    positiveNumber(probedDurationSeconds) ??
    (await sumSourceDurations(sourceFiles));
  if (durationSeconds === null) {
    throw new Error("FFprobe could not determine the DVD title duration.");
  }
  return { frameRate, durationSeconds };
}

async function sumSourceDurations(sourceFiles: string[]): Promise<number | null> {
  if (sourceFiles.length === 0) {
    return null;
  }
  const durations = await Promise.all(
    sourceFiles.map(async (filePath) => {
      try {
        const output = await captureProcess("ffprobe", [
          "-v", "error",
          "-show_entries", "format=duration",
          "-of", "default=noprint_wrappers=1:nokey=1",
          filePath
        ]);
        return positiveNumber(Number(output.trim()));
      } catch {
        return null;
      }
    })
  );
  if (durations.some((duration) => duration === null)) {
    return null;
  }
  return durations.reduce<number>((total, duration) => total + (duration ?? 0), 0);
}

function positiveNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export async function ensureRestorationDiskSpace(
  cacheDir: string,
  durationSeconds: number,
  frameRate: string,
  chunkSeconds = 60
): Promise<void> {
  const stats = await fs.statfs(cacheDir);
  const availableBytes = stats.bavail * stats.bsize;
  const framesPerSecond = fractionValue(frameRate);
  const intermediateBytes = chunkSeconds * framesPerSecond * 350_000;
  const finalVideoBytes = durationSeconds * 1_500_000;
  const estimatedBytes = Math.ceil(intermediateBytes + finalVideoBytes + 2_000_000_000);
  if (availableBytes < estimatedBytes) {
    throw new Error(
      `Not enough free space for AI restoration. Approximately ${Math.ceil(estimatedBytes / 1_000_000_000)} GB is required.`
    );
  }
}

function chunkProgress(completedChunks: number, totalChunks: number): number {
  return Math.min(90, Math.round(5 + (completedChunks / Math.max(1, totalChunks)) * 85));
}

function normalizedFrameRate(value: string | undefined): string {
  const rate = fractionValue(value);
  if (rate > 24.5 && rate < 25.5) {
    return "25/1";
  }
  if (rate > 29 && rate < 31) {
    return "30000/1001";
  }
  if (rate > 23 && rate < 24.5) {
    return "24000/1001";
  }
  throw new Error(`Unsupported or unreadable DVD frame rate: ${value ?? "unknown"}.`);
}

function fractionValue(value: string | undefined): number {
  const [numerator = Number.NaN, denominator = Number.NaN] = (value ?? "").split("/").map(Number);
  return denominator > 0 ? numerator / denominator : Number(value);
}

function captureProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-2000); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} failed: ${stderr}`)));
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
