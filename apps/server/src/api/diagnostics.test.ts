import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DiscInspection, DriveStatus, LocalMediaResponse, PlatformCapabilities } from "@discstream/contracts";
import { buildDiagnosticsWarnings, inspectStreamCache } from "./diagnostics.js";

describe("diagnostics helpers", () => {
  it("summarizes stream cache folders and files", async () => {
    const streamsDir = await fs.mkdtemp(path.join(os.tmpdir(), "discstream-diagnostics-streams-"));
    try {
      await fs.mkdir(path.join(streamsDir, "session-a"), { recursive: true });
      await fs.mkdir(path.join(streamsDir, "session-b"), { recursive: true });
      await fs.writeFile(path.join(streamsDir, "session-a", "segment-00000.ts"), "12345");
      await fs.writeFile(path.join(streamsDir, "session-b", "master.m3u8"), "123");
      await fs.writeFile(path.join(streamsDir, "session-b", "ffmpeg.log"), "ffmpeg stderr");

      const summary = await inspectStreamCache(streamsDir);

      expect(summary.directoryCount).toBe(2);
      expect(summary.fileCount).toBe(3);
      expect(summary.ffmpegLogCount).toBe(1);
      expect(summary.totalBytes).toBe(21);
      expect(summary.scanLimited).toBe(false);
      expect(summary.oldestUpdatedAt).toBeDefined();
      expect(summary.newestUpdatedAt).toBeDefined();
    } finally {
      await fs.rm(streamsDir, { recursive: true, force: true });
    }
  });

  it("builds actionable warnings for missing runtime dependencies", () => {
    const capabilities = {
      platform: "darwin",
      architecture: "arm64",
      commands: {
        ffmpeg: false,
        ffprobe: false,
        cdparanoia: false,
        cdInfo: false,
        discid: false,
        dvdbackup: false,
        lsdvd: false,
        eject: false,
        lsblk: false,
        udevadm: false,
        udisksctl: false,
        diskutil: true,
        drutil: true,
        ioreg: true
      },
      videoEncoders: {
        libx264: false,
        h264VideoToolbox: false,
        h264V4l2m2m: false
      },
      audioEncoders: {
        aac: false,
        libmp3lame: false,
        flac: false
      },
      opticalDrives: 0,
      paths: {
        configDir: "/tmp/config",
        dataDir: "/tmp/data",
        cacheDir: "/tmp/cache",
        logDir: "/tmp/logs",
        streamsDir: "/tmp/streams",
        coversDir: "/tmp/covers"
      }
    } satisfies PlatformCapabilities;
    const currentDrive = {
      driveId: "none",
      status: "no-drive",
      mediaPresent: false,
      error: {
        code: "NO_OPTICAL_DRIVE",
        message: "No optical drive detected.",
        recoverable: true
      }
    } satisfies DriveStatus;
    const disc = {
      driveId: "none",
      type: "none",
      warnings: [],
      inspectedAt: new Date().toISOString()
    } satisfies DiscInspection;
    const localMedia = {
      roots: [],
      items: []
    } satisfies LocalMediaResponse;

    const warnings = buildDiagnosticsWarnings({
      capabilities,
      currentDrive,
      disc,
      localMedia,
      streamCache: {
        directoryCount: 0,
        fileCount: 0,
        ffmpegLogCount: 0,
        totalBytes: 0,
        scanLimited: false
      }
    });

    expect(warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "COMMAND_NOT_FOUND",
        "STREAM_PROFILE_UNAVAILABLE",
        "NO_OPTICAL_DRIVE",
        "LOCAL_MEDIA_NOT_CONFIGURED",
        "LOG_FILE_NOT_CONFIGURED"
      ])
    );
  });
});
