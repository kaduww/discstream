import { z } from "zod";
import { discStreamErrorSchema } from "./errors.js";

export const playbackMediaTypeSchema = z.enum([
  "audio-cd",
  "dvd-video",
  "local-audio",
  "local-video",
  "local-dvd-video",
  "local-cd-audio"
]);

export type PlaybackMediaType = z.infer<typeof playbackMediaTypeSchema>;

export const playbackSessionStatusSchema = z.enum([
  "idle",
  "starting",
  "buffering",
  "playing",
  "stopping",
  "stopped",
  "failed"
]);

export type PlaybackSessionStatus = z.infer<typeof playbackSessionStatusSchema>;

export const videoQualityProfileSchema = z.enum(["fast", "balanced", "quality"]);
export type VideoQualityProfile = z.infer<typeof videoQualityProfileSchema>;

export const createSessionRequestSchema = z.object({
  mediaType: playbackMediaTypeSchema,
  driveId: z.string().optional(),
  localMediaId: z.string().optional(),
  track: z.number().int().positive().optional(),
  title: z.number().int().positive().optional(),
  chapter: z.number().int().positive().nullable().optional(),
  startSeconds: z.number().nonnegative().nullable().optional(),
  audioTrack: z.number().int().nullable().optional(),
  subtitleTrack: z.number().int().nullable().optional(),
  videoQuality: videoQualityProfileSchema.optional(),
  replace: z.boolean().default(false)
});

export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const playbackSessionSchema = z.object({
  sessionId: z.string(),
  status: playbackSessionStatusSchema,
  mediaType: playbackMediaTypeSchema,
  streamUrl: z.string().optional(),
  driveId: z.string().optional(),
  localMediaId: z.string().optional(),
  track: z.number().int().positive().optional(),
  title: z.number().int().positive().optional(),
  chapter: z.number().int().positive().nullable().optional(),
  startSeconds: z.number().nonnegative().optional(),
  audioTrack: z.number().int().nullable().optional(),
  subtitleTrack: z.number().int().nullable().optional(),
  videoEncoder: z.string().optional(),
  videoQuality: videoQualityProfileSchema.optional(),
  displayName: z.string().optional(),
  startedAt: z.string().optional(),
  stoppedAt: z.string().optional(),
  error: discStreamErrorSchema.optional()
});

export type PlaybackSession = z.infer<typeof playbackSessionSchema>;

export const currentSessionResponseSchema = z.object({
  session: playbackSessionSchema.nullable()
});

export type CurrentSessionResponse = z.infer<typeof currentSessionResponseSchema>;

export const stopSessionResponseSchema = z.object({
  ok: z.boolean(),
  status: playbackSessionStatusSchema
});

export type StopSessionResponse = z.infer<typeof stopSessionResponseSchema>;
