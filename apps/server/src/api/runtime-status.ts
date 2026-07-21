import type { DiscInspection, DriveStatus, DrivesResponse, PlaybackSession } from "@discstream/contracts";
import { makeError } from "@discstream/contracts";
import type { PlatformAdapter } from "@discstream/platform";
import type { AudioCdMetadataStore } from "../config/audio-cd-metadata-store.js";
import type { DvdMetadataStore } from "../config/dvd-metadata-store.js";
import type { SessionManager } from "../sessions/session-manager.js";

export interface RuntimeStatus {
  drives: DrivesResponse;
  drive: DriveStatus;
  disc: DiscInspection;
  currentSession: PlaybackSession | null;
}

export async function buildRuntimeStatus(
  platform: PlatformAdapter,
  sessions: SessionManager,
  metadata: { audioCdMetadata?: AudioCdMetadataStore; dvdMetadata?: DvdMetadataStore } = {}
): Promise<RuntimeStatus> {
  const drives = await platform.detectOpticalDrives();
  const drive = drives[0];
  if (!drive) {
    return {
      drives: { drives },
      drive: {
        driveId: "none",
        status: "no-drive" as const,
        mediaPresent: false,
        error: makeError("NO_OPTICAL_DRIVE", "No optical drive detected.", {
          hint: "Connect a USB CD/DVD drive or use local media."
        })
      },
      disc: {
        driveId: "none",
        type: "none" as const,
        warnings: [
          {
            code: "NO_OPTICAL_DRIVE",
            message: "No optical drive detected.",
            severity: "info" as const,
            hint: "Connect a drive or choose local media."
          }
        ],
        inspectedAt: new Date().toISOString()
      },
      currentSession: sessions.current
    };
  }

  const [driveStatus, rawDisc] = await Promise.all([platform.getDriveStatus(drive.id), platform.inspectInsertedMedia(drive.id)]);
  const withDvdMetadata = metadata.dvdMetadata ? await metadata.dvdMetadata.applyToDisc(rawDisc) : rawDisc;
  const disc = metadata.audioCdMetadata ? await metadata.audioCdMetadata.applyToDisc(withDvdMetadata) : withDvdMetadata;

  return {
    drives: { drives },
    drive: driveStatus,
    disc,
    currentSession: sessions.current
  };
}

export function runtimeStatusKey(status: RuntimeStatus): string {
  return JSON.stringify(status);
}
