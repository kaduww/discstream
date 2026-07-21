import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimePaths } from "@discstream/platform";

export interface RuntimePathEnvironment {
  DISCSTREAM_RUNTIME_DIR?: string;
  DISCSTREAM_CONFIG_DIR?: string;
  DISCSTREAM_DATA_DIR?: string;
  DISCSTREAM_CACHE_DIR?: string;
  DISCSTREAM_LOG_DIR?: string;
  DISCSTREAM_STREAMS_DIR?: string;
  DISCSTREAM_COVERS_DIR?: string;
}

export async function resolveRuntimePaths(cwd = process.cwd(), env: RuntimePathEnvironment = process.env): Promise<RuntimePaths> {
  const runtimeDir = path.resolve(nonEmpty(env.DISCSTREAM_RUNTIME_DIR) ?? path.join(cwd, "runtime"));
  const paths: RuntimePaths = {
    configDir: resolveRuntimePath(runtimeDir, "config", env.DISCSTREAM_CONFIG_DIR),
    dataDir: resolveRuntimePath(runtimeDir, "data", env.DISCSTREAM_DATA_DIR),
    cacheDir: resolveRuntimePath(runtimeDir, "cache", env.DISCSTREAM_CACHE_DIR),
    logDir: resolveRuntimePath(runtimeDir, "logs", env.DISCSTREAM_LOG_DIR),
    streamsDir: resolveRuntimePath(runtimeDir, "streams", env.DISCSTREAM_STREAMS_DIR),
    coversDir: resolveRuntimePath(runtimeDir, "covers", env.DISCSTREAM_COVERS_DIR)
  };

  await Promise.all(Object.values(paths).map((directory) => fs.mkdir(directory, { recursive: true })));

  return paths;
}

function resolveRuntimePath(runtimeDir: string, child: string, override: string | undefined): string {
  return path.resolve(nonEmpty(override) ?? path.join(runtimeDir, child));
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
