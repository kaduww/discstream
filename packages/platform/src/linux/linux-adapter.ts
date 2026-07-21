import fs from "node:fs/promises";
import type { DiscInspection, DriveStatus, OpticalDrive } from "@discstream/contracts";
import { makeError } from "@discstream/contracts";
import { DvdVideoInspectionCache } from "../common/dvd-video.js";
import { hasVideoTsFolder } from "../common/mounted-disc.js";
import { runCommand } from "../common/process.js";
import type { RuntimePaths } from "../platform-adapter.js";
import { BasePlatformAdapter } from "../common/base-adapter.js";
import { parseLsblkDiscInfo } from "./lsblk-disc.js";

export class LinuxPlatformAdapter extends BasePlatformAdapter {
  readonly platform = "linux" as const;
  readonly displayName = "Linux";
  private readonly dvdVideoCache = new DvdVideoInspectionCache();

  constructor(paths: RuntimePaths) {
    super(paths);
  }

  async detectOpticalDrives(): Promise<OpticalDrive[]> {
    let entries: string[];
    try {
      entries = await fs.readdir("/dev");
    } catch {
      return [];
    }

    return entries
      .filter((entry) => /^sr\d+$/.test(entry))
      .sort()
      .map((entry, index) => ({
        id: `drive-${index}`,
        systemDevice: `/dev/${entry}`,
        displayName: `Optical Drive ${index + 1}`,
        transport: "unknown",
        capabilities: {
          audioCd: true,
          dvdVideo: true,
          eject: true,
          closeTray: false
        }
      }));
  }

  override async getDriveStatus(driveId: string): Promise<DriveStatus> {
    const drive = (await this.detectOpticalDrives()).find((item) => item.id === driveId);
    if (!drive) {
      return {
        driveId,
        status: "no-drive",
        mediaPresent: false,
        error: makeError("NO_OPTICAL_DRIVE", "No optical drive was found for this request.", {
          hint: "Connect a USB CD/DVD drive or rescan from the web app."
        })
      };
    }

    const info = await this.readLsblkInfo(drive.systemDevice);
    return {
      driveId: drive.id,
      status: info.mediaPresent ? "media-present" : "empty",
      mediaPresent: info.mediaPresent,
      mountedVolume: info.mountedVolume
    };
  }

  override async inspectInsertedMedia(driveId: string): Promise<DiscInspection> {
    const drive = (await this.detectOpticalDrives()).find((item) => item.id === driveId);
    if (!drive) {
      return {
        driveId,
        type: "none",
        warnings: [
          {
            code: "NO_OPTICAL_DRIVE",
            message: "No optical drive detected.",
            severity: "info",
            hint: "Connect a drive or choose local media."
          }
        ],
        inspectedAt: new Date().toISOString()
      };
    }

    const info = await this.readLsblkInfo(drive.systemDevice);
    if (!info.mediaPresent) {
      return {
        driveId,
        type: "none",
        warnings: [],
        inspectedAt: new Date().toISOString()
      };
    }

    const hasVideoTs = info.mountedVolume ? await hasVideoTsFolder(info.mountedVolume.mountPath) : false;
    const type = hasVideoTs ? "dvd-video" : info.inferredDiscType;
    const dvdVideo =
      type === "dvd-video" && info.mountedVolume
        ? await this.dvdVideoCache.inspect(info.mountedVolume.mountPath, info.mountedVolume.label).catch(() => ({
            label: info.mountedVolume?.label,
            titles: [],
            metadataSource: "none" as const
          }))
        : undefined;

    return {
      driveId,
      type,
      label: info.mountedVolume?.label,
      mountedVolume: info.mountedVolume,
      dvdVideo,
      warnings:
        type === "unknown"
          ? [
              {
                code: "DISC_TYPE_UNKNOWN",
                message: "A disc is present, but DiscStream could not classify it yet.",
                severity: "warning",
                hint: "Mount the disc or install extra CD/DVD inspection tools."
              }
            ]
          : [],
      inspectedAt: new Date().toISOString()
    };
  }

  async eject(driveId: string): Promise<void> {
    const drive = (await this.detectOpticalDrives()).find((item) => item.id === driveId);
    if (!drive) {
      throw makeError("NO_OPTICAL_DRIVE", "No optical drive was found for eject.");
    }

    const result = await runCommand("eject", [drive.systemDevice], { timeoutMs: 4000 });
    if (result.code !== 0) {
      throw makeError("UNSUPPORTED_OPERATION", "The drive could not be ejected.", {
        detail: result.stderr.trim() || result.stdout.trim()
      });
    }
  }

  protected override async detectRaspberryPi(): Promise<boolean | undefined> {
    try {
      const model = await fs.readFile("/proc/device-tree/model", "utf8");
      return /raspberry pi/i.test(model);
    } catch {
      try {
        const cpuInfo = await fs.readFile("/proc/cpuinfo", "utf8");
        return /raspberry pi/i.test(cpuInfo);
      } catch {
        return undefined;
      }
    }
  }

  private async readLsblkInfo(devicePath: string) {
    const result = await runCommand(
      "lsblk",
      ["-J", "-o", "NAME,PATH,TYPE,MOUNTPOINT,LABEL,FSTYPE", devicePath],
      { timeoutMs: 2500 }
    );
    if (result.code !== 0) {
      return {
        devicePath,
        mediaPresent: false,
        inferredDiscType: "none" as const
      };
    }

    try {
      return parseLsblkDiscInfo(result.stdout, devicePath);
    } catch {
      return {
        devicePath,
        mediaPresent: false,
        inferredDiscType: "none" as const
      };
    }
  }
}
