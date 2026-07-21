import { z } from "zod";

export const discStreamErrorCodeSchema = z.enum([
  "UNSUPPORTED_PLATFORM",
  "NO_OPTICAL_DRIVE",
  "DRIVE_BUSY",
  "NO_DISC",
  "UNKNOWN_DISC_TYPE",
  "DISC_INSPECTION_FAILED",
  "COMMAND_NOT_FOUND",
  "PERMISSION_DENIED",
  "UNSUPPORTED_OPERATION",
  "STREAM_PROFILE_UNAVAILABLE",
  "STREAM_START_FAILED",
  "STREAM_PROCESS_EXITED",
  "STREAM_TIMEOUT",
  "MEDIA_NOT_READABLE",
  "UNSUPPORTED_MEDIA_FORMAT",
  "LOCAL_MEDIA_ROOT_UNAVAILABLE",
  "MEDIA_PATH_NOT_ALLOWED",
  "METADATA_LOOKUP_FAILED",
  "VALIDATION_ERROR"
]);

export type DiscStreamErrorCode = z.infer<typeof discStreamErrorCodeSchema>;

export const discStreamErrorSchema = z.object({
  code: discStreamErrorCodeSchema,
  message: z.string(),
  detail: z.string().optional(),
  hint: z.string().optional(),
  recoverable: z.boolean()
});

export type DiscStreamError = z.infer<typeof discStreamErrorSchema>;

export const discStreamWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  hint: z.string().optional()
});

export type DiscStreamWarning = z.infer<typeof discStreamWarningSchema>;

export const errorResponseSchema = z.object({
  error: discStreamErrorSchema
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export function makeError(
  code: DiscStreamErrorCode,
  message: string,
  options: {
    detail?: string;
    hint?: string;
    recoverable?: boolean;
  } = {}
): DiscStreamError {
  return {
    code,
    message,
    detail: options.detail,
    hint: options.hint,
    recoverable: options.recoverable ?? true
  };
}
