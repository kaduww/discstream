import type { DiscInspection, DriveStatus, MountedVolume, OpticalDrive } from "@discstream/contracts";
import { makeError } from "@discstream/contracts";
import { runCommand } from "../common/process.js";
import { BasePlatformAdapter } from "../common/base-adapter.js";
import { DvdVideoInspectionCache } from "../common/dvd-video.js";
import { hasVideoTsFolder } from "../common/mounted-disc.js";
import type { RuntimePaths } from "../platform-adapter.js";
import { readMountedAudioCdTracks } from "./audio-cd-volume.js";
import { parseDiskutilInfo } from "./diskutil-info.js";
import { parseDrutilStatus } from "./drutil-status.js";
import { isMacosAudioCdFilesystem, isMacosOpticalFilesystem, parseMacosMountOutput, type MacosMountedVolume } from "./mount-output.js";

export class MacosPlatformAdapter extends BasePlatformAdapter {
  readonly platform = "darwin" as const;
  readonly displayName = "macOS";
  private readonly dvdVideoCache = new DvdVideoInspectionCache();

  constructor(paths: RuntimePaths) {
    super(paths);
  }

  async detectOpticalDrives(): Promise<OpticalDrive[]> {
    const result = await runCommand("drutil", ["status"], { timeoutMs: 2500 });
    const parsed = parseDrutilStatus(result.stdout + result.stderr);
    const mountedOpticalVolume = await this.readMountedOpticalVolume();
    if ((result.code !== 0 || !parsed.hasDrive) && !mountedOpticalVolume) {
      return [];
    }

    return [
      {
        id: "drive-0",
        systemDevice: parsed.device ?? mountedOpticalVolume?.device ?? "drutil",
        displayName: mountedOpticalVolume?.label ?? "macOS Optical Drive",
        transport: "unknown",
        capabilities: {
          audioCd: true,
          dvdVideo: true,
          eject: true,
          closeTray: true
        }
      }
    ];
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

    const parsed = await this.readDrutilStatus();
    const mountedVolume = await this.readMountedVolume(parsed.device ?? drive.systemDevice);
    return {
      driveId: drive.id,
      status: parsed.mediaPresent || mountedVolume ? "media-present" : "empty",
      mediaPresent: parsed.mediaPresent || Boolean(mountedVolume),
      mountedVolume
    };
  }

  override async inspectInsertedMedia(driveId: string): Promise<DiscInspection> {
    const status = await this.getDriveStatus(driveId);
    if (status.status === "no-drive") {
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

    if (!status.mediaPresent) {
      return {
        driveId,
        type: "none",
        warnings: [],
        inspectedAt: new Date().toISOString()
      };
    }

    const parsed = await this.readDrutilStatus();
    const mountedVolume = status.mountedVolume;
    const hasVideoTs = mountedVolume ? await hasVideoTsFolder(mountedVolume.mountPath) : false;
    const type = isMacosAudioCdFilesystem(mountedVolume?.filesystem)
      ? "audio-cd"
      : hasVideoTs
        ? "dvd-video"
        : parsed.inferredDiscType === "dvd-video" && mountedVolume
          ? "data-disc"
          : parsed.inferredDiscType;
    const audioTracks = type === "audio-cd" && mountedVolume ? await readMountedAudioCdTracks(mountedVolume.mountPath) : [];
    const dvdVideo =
      type === "dvd-video" && mountedVolume
        ? await this.dvdVideoCache.inspect(mountedVolume.mountPath, mountedVolume.label).catch(() => ({
            label: mountedVolume.label,
            titles: [],
            metadataSource: "none" as const
          }))
        : undefined;

    return {
      driveId,
      type,
      label: mountedVolume?.label,
      mountedVolume,
      audioCd:
        type === "audio-cd"
          ? {
              durationSeconds: audioTracks.reduce((total, track) => total + (track.durationSeconds ?? 0), 0) || undefined,
              tracks: audioTracks,
              metadataSource: "none"
            }
          : undefined,
      dvdVideo,
      warnings:
        type === "unknown"
          ? [
              {
                code: "DISC_TYPE_UNKNOWN",
                message: "A disc is present, but DiscStream could not classify it yet.",
                severity: "warning",
                hint: "Diagnostics may show whether extra CD/DVD tools are missing."
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

    const result = await runCommand("drutil", ["tray", "eject"], { timeoutMs: 4000 });
    if (result.code !== 0) {
      throw makeError("UNSUPPORTED_OPERATION", "The drive could not be ejected.", {
        detail: result.stderr.trim() || result.stdout.trim()
      });
    }
  }

  override async closeTray(driveId: string): Promise<void> {
    const drive = (await this.detectOpticalDrives()).find((item) => item.id === driveId);
    if (!drive) {
      throw makeError("NO_OPTICAL_DRIVE", "No optical drive was found for close tray.");
    }

    const result = await runCommand("drutil", ["tray", "close"], { timeoutMs: 4000 });
    if (result.code !== 0) {
      throw makeError("UNSUPPORTED_OPERATION", "The drive tray could not be closed.", {
        detail: result.stderr.trim() || result.stdout.trim()
      });
    }
  }

  private async readDrutilStatus() {
    const result = await runCommand("drutil", ["status"], { timeoutMs: 2500 });
    return parseDrutilStatus(result.stdout + result.stderr);
  }

  private async readMountedVolume(device: string): Promise<MountedVolume | undefined> {
    const mountedVolume = await this.readMountedOpticalVolume(device);
    const result = await runCommand("diskutil", ["info", device], { timeoutMs: 2500 });
    if (result.code !== 0) {
      return mountedVolume;
    }

    const diskutilVolume = parseDiskutilInfo(result.stdout);
    if (!diskutilVolume) {
      return mountedVolume;
    }

    return {
      ...diskutilVolume,
      filesystem: mountedVolume?.filesystem ?? diskutilVolume.filesystem
    };
  }

  private async readMountedOpticalVolume(device?: string): Promise<MacosMountedVolume | undefined> {
    const result = await runCommand("mount", [], { timeoutMs: 2500 });
    if (result.code !== 0) {
      return undefined;
    }

    const volumes = parseMacosMountOutput(result.stdout).filter((volume) => isMacosOpticalFilesystem(volume.filesystem));
    if (device && device !== "drutil") {
      return volumes.find((volume) => volume.device === device) ?? volumes[0];
    }

    return volumes[0];
  }
}
