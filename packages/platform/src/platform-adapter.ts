import type {
  DiscInspection,
  DriveStatus,
  MountedVolume,
  OpticalDrive,
  PlatformCapabilities,
  SupportedPlatform
} from "@discstream/contracts";

export interface RuntimePaths {
  configDir: string;
  dataDir: string;
  cacheDir: string;
  logDir: string;
  streamsDir: string;
  coversDir: string;
}

export interface DriveEvent {
  type: "added" | "removed" | "changed";
  driveId?: string;
}

export interface DriveWatcher {
  close(): Promise<void> | void;
}

export interface PlatformAdapter {
  readonly platform: SupportedPlatform;
  readonly displayName: string;

  detectCapabilities(): Promise<PlatformCapabilities>;
  detectOpticalDrives(): Promise<OpticalDrive[]>;
  getDriveStatus(driveId: string): Promise<DriveStatus>;
  inspectInsertedMedia(driveId: string): Promise<DiscInspection>;
  eject(driveId: string): Promise<void>;
  closeTray(driveId: string): Promise<void>;
  mount(driveId: string): Promise<MountedVolume | null>;
  unmount(driveId: string): Promise<void>;
  watchDrives(onEvent: (event: DriveEvent) => void): Promise<DriveWatcher>;
}
