import fs from "node:fs/promises";
import path from "node:path";
import type { MountedVolume } from "@discstream/contracts";

export interface MountedDiscVolume extends MountedVolume {
  hasVideoTs: boolean;
}

export async function findMountedDiscVolumes(rootPath: string): Promise<MountedDiscVolume[]> {
  let entries;
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const volumes: MountedDiscVolume[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const mountPath = path.join(rootPath, entry.name);
    try {
      await fs.access(mountPath);
      volumes.push({
        mountPath,
        label: entry.name,
        hasVideoTs: await hasVideoTsFolder(mountPath)
      });
    } catch {
      continue;
    }
  }

  return volumes;
}

export async function hasVideoTsFolder(mountPath: string): Promise<boolean> {
  const candidates = [path.join(mountPath, "VIDEO_TS"), path.join(mountPath, "video_ts")];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}
