import fs from "node:fs/promises";
import path from "node:path";
import type { MountedVolume, OpticalDrive } from "@discstream/contracts";
import { hasVideoTsFolder } from "../common/mounted-disc.js";

export interface WslDvdDrive {
  drive: OpticalDrive;
  mountedVolume: MountedVolume;
}

export async function detectWslDvdDrives(mountRoot = "/mnt", forceWsl?: boolean): Promise<WslDvdDrive[]> {
  if (!(forceWsl ?? (await isWsl()))) {
    return [];
  }

  let entries;
  try {
    entries = await fs.readdir(mountRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const drives: WslDvdDrive[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !/^[a-z]$/i.test(entry.name)) {
      continue;
    }

    const mountPath = path.join(mountRoot, entry.name);
    if (!(await hasVideoTsFolder(mountPath))) {
      continue;
    }

    const letter = entry.name.toUpperCase();
    drives.push({
      drive: {
        id: `wsl-drive-${entry.name.toLowerCase()}`,
        systemDevice: `${letter}:`,
        displayName: `Windows DVD Drive ${letter}:`,
        transport: "unknown",
        capabilities: {
          audioCd: false,
          dvdVideo: true,
          eject: false,
          closeTray: false
        }
      },
      mountedVolume: {
        mountPath,
        label: `${letter}:`,
        filesystem: "drvfs"
      }
    });
  }

  return drives;
}

async function isWsl(): Promise<boolean> {
  const values = await Promise.all([
    fs.readFile("/proc/sys/kernel/osrelease", "utf8").catch(() => ""),
    fs.readFile("/proc/version", "utf8").catch(() => "")
  ]);
  return values.some((value) => /microsoft|wsl/i.test(value));
}
