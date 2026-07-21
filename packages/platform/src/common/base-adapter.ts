import os from "node:os";
import type { DiscInspection, DriveStatus, OpticalDrive, PlatformCapabilities, SupportedPlatform } from "@discstream/contracts";
import { makeError } from "@discstream/contracts";
import type { DriveEvent, DriveWatcher, PlatformAdapter, RuntimePaths } from "../platform-adapter.js";
import { detectCommands } from "./command-detector.js";
import { detectFfmpegEncoders } from "./ffmpeg-encoders.js";

export abstract class BasePlatformAdapter implements PlatformAdapter {
  abstract readonly platform: SupportedPlatform;
  abstract readonly displayName: string;

  protected constructor(protected readonly paths: RuntimePaths) {}

  async detectCapabilities(): Promise<PlatformCapabilities> {
    const commands = await detectCommands();
    const encoders = await detectFfmpegEncoders(commands.ffmpeg);
    const drives = await this.detectOpticalDrives();

    return {
      platform: this.platform,
      platformVersion: os.release(),
      architecture: os.arch(),
      isRaspberryPi: await this.detectRaspberryPi(),
      commands,
      videoEncoders: encoders.videoEncoders,
      audioEncoders: encoders.audioEncoders,
      opticalDrives: drives.length,
      paths: this.paths
    };
  }

  async getDriveStatus(driveId: string): Promise<DriveStatus> {
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

    return {
      driveId: drive.id,
      status: "empty",
      mediaPresent: false
    };
  }

  async inspectInsertedMedia(driveId: string): Promise<DiscInspection> {
    return {
      driveId,
      type: "none",
      warnings: [],
      inspectedAt: new Date().toISOString()
    };
  }

  async closeTray(_driveId: string): Promise<void> {
    throw makeError("UNSUPPORTED_OPERATION", "This platform adapter does not support closing the tray yet.");
  }

  async mount(_driveId: string) {
    return null;
  }

  async unmount(_driveId: string): Promise<void> {
    return;
  }

  async watchDrives(_onEvent: (event: DriveEvent) => void): Promise<DriveWatcher> {
    return {
      close() {
        return;
      }
    };
  }

  protected async detectRaspberryPi(): Promise<boolean | undefined> {
    return undefined;
  }

  abstract detectOpticalDrives(): Promise<OpticalDrive[]>;
  abstract eject(driveId: string): Promise<void>;
}
