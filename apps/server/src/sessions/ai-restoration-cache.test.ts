import path from "node:path";
import { describe, expect, it } from "vitest";
import { aiRestorationCacheKey, aiRestorationCachePaths } from "./ai-restoration-cache.js";

const identity = {
  sourceId: "dvd:example:title:1",
  sourceSizeBytes: 4_700_000_000,
  sourceModifiedMs: 1_700_000_000_123,
  scale: "2x" as const,
  model: "realesrgan-x4plus"
};

describe("AI restoration cache", () => {
  it("uses a stable key and invalidates it when the restoration inputs change", () => {
    expect(aiRestorationCacheKey(identity)).toBe(aiRestorationCacheKey({ ...identity }));
    expect(aiRestorationCacheKey(identity)).not.toBe(aiRestorationCacheKey({ ...identity, scale: "4x" }));
    expect(aiRestorationCacheKey(identity)).not.toBe(aiRestorationCacheKey({ ...identity, sourceModifiedMs: identity.sourceModifiedMs + 1 }));
  });

  it("keeps restored outputs isolated under the runtime cache", () => {
    const paths = aiRestorationCachePaths("/runtime/cache", identity);

    expect(paths.directory).toBe(path.join("/runtime/cache", "ai-restorations", aiRestorationCacheKey(identity)));
    expect(paths.outputPath).toBe(path.join(paths.directory, "restored.mp4"));
    expect(paths.manifestPath).toBe(path.join(paths.directory, "manifest.json"));
    expect(paths.logPath).toBe(path.join(paths.directory, "restoration.log"));
  });
});
