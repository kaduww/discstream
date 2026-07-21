import { z } from "zod";
import { dvdVideoDiscSchema } from "./disc.js";
import { discStreamWarningSchema } from "./errors.js";

export const mediaSourceKindSchema = z.enum(["optical-disc", "local-file", "local-folder", "disc-image"]);
export type MediaSourceKind = z.infer<typeof mediaSourceKindSchema>;

export const localMediaTypeSchema = z.enum([
  "audio-file",
  "video-file",
  "dvd-video-folder",
  "cd-audio-image",
  "dvd-image",
  "unknown"
]);

export type LocalMediaType = z.infer<typeof localMediaTypeSchema>;

export const localMediaRootSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  enabled: z.boolean()
});

export type LocalMediaRoot = z.infer<typeof localMediaRootSchema>;

export const localAudioFileSchema = z.object({
  format: z.enum(["mp3", "aac", "m4a", "flac", "wav", "ogg", "opus", "unknown"]),
  codec: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  albumTitle: z.string().optional(),
  albumArtist: z.string().optional(),
  trackNumber: z.number().int().positive().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  bitrateKbps: z.number().nonnegative().optional(),
  coverUrl: z.string().optional()
});

export type LocalAudioFile = z.infer<typeof localAudioFileSchema>;

export const localVideoFileSchema = z.object({
  container: z.enum(["mp4", "m4v", "mov", "mkv", "webm", "avi", "mpeg", "unknown"]),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  bitrateKbps: z.number().nonnegative().optional(),
  title: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  directPlaySupported: z.boolean(),
  transcodeRequired: z.boolean()
});

export type LocalVideoFile = z.infer<typeof localVideoFileSchema>;

export const localMediaItemSchema = z.object({
  id: z.string(),
  rootId: z.string(),
  sourceKind: mediaSourceKindSchema,
  mediaType: localMediaTypeSchema,
  displayName: z.string(),
  relativePath: z.string(),
  artworkUrl: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  audioFile: localAudioFileSchema.optional(),
  videoFile: localVideoFileSchema.optional(),
  dvdVideo: dvdVideoDiscSchema.optional(),
  warnings: z.array(discStreamWarningSchema),
  inspectedAt: z.string().optional()
});

export type LocalMediaItem = z.infer<typeof localMediaItemSchema>;

export const localMediaResponseSchema = z.object({
  roots: z.array(localMediaRootSchema),
  items: z.array(localMediaItemSchema)
});

export type LocalMediaResponse = z.infer<typeof localMediaResponseSchema>;

export const localMediaFolderBrowserRootSchema = z.object({
  displayName: z.string(),
  path: z.string()
});

export const localMediaFolderBrowserDirectorySchema = z.object({
  name: z.string(),
  path: z.string()
});

export const localMediaFolderBrowserResponseSchema = z.object({
  roots: z.array(localMediaFolderBrowserRootSchema),
  currentPath: z.string(),
  parentPath: z.string().nullable(),
  directories: z.array(localMediaFolderBrowserDirectorySchema)
});

export type LocalMediaFolderBrowserResponse = z.infer<typeof localMediaFolderBrowserResponseSchema>;
