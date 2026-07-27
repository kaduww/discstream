import { z } from "zod";

export const aiRestorationStatusSchema = z.enum(["queued", "extracting", "upscaling", "encoding", "paused", "completed", "failed", "cancelled"]);
export type AiRestorationStatus = z.infer<typeof aiRestorationStatusSchema>;

export const aiRestorationJobSchema = z.object({
  jobId: z.string(),
  status: aiRestorationStatusSchema,
  title: z.number().int().positive(),
  progress: z.number().min(0).max(100),
  etaSeconds: z.number().nonnegative().optional(),
  processedBlocks: z.number().int().nonnegative().optional(),
  totalBlocks: z.number().int().positive().optional(),
  message: z.string().optional(),
  streamUrl: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  error: z.string().optional()
});

export type AiRestorationJob = z.infer<typeof aiRestorationJobSchema>;
