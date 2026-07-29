import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectWslDvdDrives } from "./wsl-drive-letter.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("detectWslDvdDrives", () => {
  it("maps Windows drive-letter mounts containing VIDEO_TS", async () => {
    const mountRoot = await fs.mkdtemp(path.join(os.tmpdir(), "discstream-wsl-"));
    temporaryDirectories.push(mountRoot);
    await fs.mkdir(path.join(mountRoot, "d", "VIDEO_TS"), { recursive: true });
    await fs.mkdir(path.join(mountRoot, "e", "video_ts"), { recursive: true });
    await fs.mkdir(path.join(mountRoot, "c", "Users"), { recursive: true });

    const drives = await detectWslDvdDrives(mountRoot, true);

    expect(drives.map(({ drive, mountedVolume }) => ({
      id: drive.id,
      systemDevice: drive.systemDevice,
      displayName: drive.displayName,
      mountPath: mountedVolume.mountPath
    }))).toEqual([
      {
        id: "wsl-drive-d",
        systemDevice: "D:",
        displayName: "Windows DVD Drive D:",
        mountPath: path.join(mountRoot, "d")
      },
      {
        id: "wsl-drive-e",
        systemDevice: "E:",
        displayName: "Windows DVD Drive E:",
        mountPath: path.join(mountRoot, "e")
      }
    ]);
  });

  it("does not scan drive-letter mounts outside WSL", async () => {
    const mountRoot = await fs.mkdtemp(path.join(os.tmpdir(), "discstream-wsl-"));
    temporaryDirectories.push(mountRoot);
    await fs.mkdir(path.join(mountRoot, "d", "VIDEO_TS"), { recursive: true });

    await expect(detectWslDvdDrives(mountRoot, false)).resolves.toEqual([]);
  });
});
