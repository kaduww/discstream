import { z } from "zod";
import { platformCapabilitiesSchema } from "./capabilities.js";
import { discInspectionSchema } from "./disc.js";
import { driveStatusSchema, drivesResponseSchema } from "./drive.js";
import { discStreamErrorSchema, discStreamWarningSchema } from "./errors.js";
import { localMediaResponseSchema } from "./local-media.js";

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  startedAt: z.string()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const runtimePathsSchema = z.object({
  configDir: z.string(),
  dataDir: z.string(),
  cacheDir: z.string(),
  logDir: z.string(),
  streamsDir: z.string(),
  coversDir: z.string()
});

export const diagnosticsStreamCacheSchema = z.object({
  directoryCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  ffmpegLogCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  oldestUpdatedAt: z.string().optional(),
  newestUpdatedAt: z.string().optional(),
  scanLimited: z.boolean()
});

export const diagnosticsRuntimeSchema = z.object({
  paths: runtimePathsSchema,
  streamCache: diagnosticsStreamCacheSchema,
  staleStreamsRemovedOnStartup: z.number().int().nonnegative(),
  logging: z.object({
    level: z.string(),
    filePath: z.string().optional()
  })
});

export const diagnosticsConfigurationSchema = z.object({
  server: z.object({
    host: z.string(),
    port: z.number().int().positive()
  }),
  drives: z.object({
    pollingIntervalMs: z.number().int().nonnegative()
  }),
  localMedia: z.object({
    rootCount: z.number().int().nonnegative(),
    browseRootCount: z.number().int().nonnegative(),
    includeExtensions: z.array(z.string())
  })
});

export const diagnosticsResponseSchema = z.object({
  health: healthResponseSchema,
  capabilities: platformCapabilitiesSchema,
  drives: drivesResponseSchema,
  currentDrive: driveStatusSchema,
  disc: discInspectionSchema,
  localMedia: localMediaResponseSchema,
  runtime: diagnosticsRuntimeSchema,
  configuration: diagnosticsConfigurationSchema,
  warnings: z.array(discStreamWarningSchema),
  lastSessionError: discStreamErrorSchema.optional()
});

export type DiagnosticsResponse = z.infer<typeof diagnosticsResponseSchema>;
