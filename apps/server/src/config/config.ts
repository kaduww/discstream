import path from "node:path";
import type { LocalMediaRootConfig } from "@discstream/local-media";
import { supportedExtensions } from "@discstream/local-media";
import { defaultServerFolderBrowseRoots } from "./server-folder-browser.js";

export interface DiscStreamServerConfig {
  server: {
    host: string;
    port: number;
  };
  drives: {
    pollingIntervalMs: number;
  };
  localMedia: {
    roots: LocalMediaRootConfig[];
    browseRoots: string[];
    includeExtensions: string[];
  };
  logging: {
    level: string;
    filePath?: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DiscStreamServerConfig {
  const localRoots = env.DISCSTREAM_LOCAL_MEDIA_ROOTS?.trim()
    ? env.DISCSTREAM_LOCAL_MEDIA_ROOTS.split(path.delimiter).filter(Boolean).map((rootPath, index) => ({
        displayName: `Local Media ${index + 1}`,
        path: rootPath,
        enabled: true
      }))
    : [];

  return {
    server: {
      host: env.DISCSTREAM_HOST ?? "0.0.0.0",
      port: Number.parseInt(env.DISCSTREAM_PORT ?? "7373", 10)
    },
    drives: {
      pollingIntervalMs: Number.parseInt(env.DISCSTREAM_DRIVE_POLLING_MS ?? "2000", 10)
    },
    localMedia: {
      roots: localRoots,
      browseRoots: env.DISCSTREAM_LOCAL_MEDIA_BROWSE_ROOTS?.trim()
        ? env.DISCSTREAM_LOCAL_MEDIA_BROWSE_ROOTS.split(path.delimiter).filter(Boolean)
        : defaultServerFolderBrowseRoots(),
      includeExtensions:
        env.DISCSTREAM_LOCAL_MEDIA_EXTENSIONS?.split(",").map((item) => item.trim()).filter(Boolean) ?? supportedExtensions()
    },
    logging: {
      level: env.LOG_LEVEL ?? "info",
      filePath: nonEmpty(env.DISCSTREAM_LOG_FILE)
    }
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
