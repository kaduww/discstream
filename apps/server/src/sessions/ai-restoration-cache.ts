import crypto from "node:crypto";
import path from "node:path";

export type AiRestorationScale = "2x" | "4x";

export interface AiRestorationCacheIdentity {
  sourceId: string;
  sourceSizeBytes: number;
  sourceModifiedMs: number;
  scale: AiRestorationScale;
  model: string;
}

export interface AiRestorationCachePaths {
  directory: string;
  outputPath: string;
  manifestPath: string;
  logPath: string;
}

export function aiRestorationCacheKey(identity: AiRestorationCacheIdentity): string {
  const stableIdentity = [
    identity.sourceId,
    identity.sourceSizeBytes,
    Math.trunc(identity.sourceModifiedMs),
    identity.scale,
    identity.model
  ].join("\0");

  return crypto.createHash("sha256").update(stableIdentity).digest("hex").slice(0, 24);
}

export function aiRestorationCachePaths(cacheDir: string, identity: AiRestorationCacheIdentity): AiRestorationCachePaths {
  const directory = path.join(cacheDir, "ai-restorations", aiRestorationCacheKey(identity));

  return {
    directory,
    outputPath: path.join(directory, "restored.mp4"),
    manifestPath: path.join(directory, "manifest.json"),
    logPath: path.join(directory, "restoration.log")
  };
}
