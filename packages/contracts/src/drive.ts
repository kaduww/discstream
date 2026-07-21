import { z } from "zod";
import { discStreamErrorSchema } from "./errors.js";

export const mountedVolumeSchema = z.object({
  mountPath: z.string(),
  label: z.string().optional(),
  filesystem: z.string().optional(),
  readOnly: z.boolean().optional()
});

export type MountedVolume = z.infer<typeof mountedVolumeSchema>;

export const opticalDriveSchema = z.object({
  id: z.string(),
  systemDevice: z.string(),
  displayName: z.string(),
  vendor: z.string().optional(),
  model: z.string().optional(),
  transport: z.enum(["usb", "sata", "internal", "unknown"]),
  capabilities: z.object({
    audioCd: z.boolean(),
    dvdVideo: z.boolean(),
    eject: z.boolean(),
    closeTray: z.boolean()
  })
});

export type OpticalDrive = z.infer<typeof opticalDriveSchema>;

export const driveStatusSchema = z.object({
  driveId: z.string(),
  status: z.enum(["no-drive", "empty", "tray-open", "media-present", "busy", "error"]),
  mediaPresent: z.boolean(),
  trayOpen: z.boolean().optional(),
  mountedVolume: mountedVolumeSchema.optional(),
  error: discStreamErrorSchema.optional()
});

export type DriveStatus = z.infer<typeof driveStatusSchema>;

export const drivesResponseSchema = z.object({
  drives: z.array(opticalDriveSchema)
});

export type DrivesResponse = z.infer<typeof drivesResponseSchema>;
