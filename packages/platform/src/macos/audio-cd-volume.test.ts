import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readMountedAudioCdTracks } from "./audio-cd-volume.js";

describe("readMountedAudioCdTracks", () => {
  it("reads mounted AIFF tracks in numeric order", async () => {
    const mountPath = await mkdtemp(path.join(os.tmpdir(), "discstream-cd-"));
    await writeFile(path.join(mountPath, "2 Second Song.aiff"), Buffer.alloc(44_100 * 2 * 2 * 3));
    await writeFile(path.join(mountPath, "1 First Song.aiff"), Buffer.alloc(44_100 * 2 * 2 * 2));
    await writeFile(path.join(mountPath, ".TOC.plist"), "ignored");
    await mkdir(path.join(mountPath, "Artwork"));

    await expect(readMountedAudioCdTracks(mountPath)).resolves.toEqual([
      {
        number: 1,
        title: "First Song",
        durationSeconds: 2
      },
      {
        number: 2,
        title: "Second Song",
        durationSeconds: 3
      }
    ]);
  });
});
