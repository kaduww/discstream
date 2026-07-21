import { z } from "zod";
import { mountedVolumeSchema } from "./drive.js";
import { discStreamWarningSchema } from "./errors.js";

export const discTypeSchema = z.enum(["none", "audio-cd", "dvd-video", "data-disc", "unknown"]);
export type DiscType = z.infer<typeof discTypeSchema>;

export const audioCdTrackSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().optional(),
  artist: z.string().optional(),
  durationSeconds: z.number().nonnegative().optional()
});

export type AudioCdTrack = z.infer<typeof audioCdTrackSchema>;

export const audioCdDiscSchema = z.object({
  discId: z.string().optional(),
  albumTitle: z.string().optional(),
  albumArtist: z.string().optional(),
  coverUrl: z.string().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  tracks: z.array(audioCdTrackSchema),
  metadataSource: z.enum(["none", "musicbrainz", "manual", "cache"]).optional()
});

export type AudioCdDisc = z.infer<typeof audioCdDiscSchema>;

export const dvdChapterSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).optional(),
  startSeconds: z.number().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional()
});

export const dvdAudioTrackSchema = z.object({
  id: z.number().int(),
  language: z.string().optional(),
  codec: z.string().optional(),
  channels: z.string().optional()
});

export const dvdSubtitleTrackSchema = z.object({
  id: z.number().int(),
  language: z.string().optional(),
  format: z.string().optional()
});

export const dvdTitleSchema = z.object({
  id: z.number().int(),
  durationSeconds: z.number().nonnegative().optional(),
  chapters: z.array(dvdChapterSchema).optional(),
  audioTracks: z.array(dvdAudioTrackSchema).optional(),
  subtitleTracks: z.array(dvdSubtitleTrackSchema).optional(),
  aspectRatio: z.string().optional()
});

export type DvdTitle = z.infer<typeof dvdTitleSchema>;

export const dvdVideoDiscSchema = z.object({
  label: z.string().optional(),
  mainTitleId: z.number().int().optional(),
  titles: z.array(dvdTitleSchema),
  metadataSource: z.enum(["none", "manual", "cache"]).optional()
});

export type DvdVideoDisc = z.infer<typeof dvdVideoDiscSchema>;

export const discInspectionSchema = z.object({
  driveId: z.string(),
  type: discTypeSchema,
  label: z.string().optional(),
  mountedVolume: mountedVolumeSchema.optional(),
  audioCd: audioCdDiscSchema.optional(),
  dvdVideo: dvdVideoDiscSchema.optional(),
  warnings: z.array(discStreamWarningSchema),
  inspectedAt: z.string()
});

export type DiscInspection = z.infer<typeof discInspectionSchema>;
