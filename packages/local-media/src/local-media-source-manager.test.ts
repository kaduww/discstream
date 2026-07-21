import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMediaSourceManager } from "./local-media-source-manager.js";

const tempDirs: string[] = [];

describe("LocalMediaSourceManager", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("exposes sibling artwork through a stable local media artwork URL", async () => {
    const rootPath = await createTempDir();
    await writeFile(path.join(rootPath, "track.mp3"), "fake mp3");
    await writeFile(path.join(rootPath, "cover.JPG"), "fake cover");

    const manager = new LocalMediaSourceManager({
      roots: [{ id: "music", displayName: "Music", path: rootPath, enabled: true }],
      enableFfprobe: false
    });

    const response = await manager.list();
    const item = response.items[0];
    expect(item).toBeDefined();
    if (!item) {
      throw new Error("Expected one local media item.");
    }
    expect(item).toMatchObject({
      mediaType: "audio-file",
      artworkUrl: expect.stringMatching(/^\/api\/local-media\/media-[a-f0-9]+\/artwork$/),
      audioFile: {
        coverUrl: expect.stringMatching(/^\/api\/local-media\/media-[a-f0-9]+\/artwork$/)
      }
    });
    expect(item.artworkUrl).not.toContain(rootPath);

    const artwork = await manager.resolveArtworkPath(item.id);
    expect(artwork).toEqual({
      absolutePath: path.join(rootPath, "cover.JPG"),
      mimeType: "image/jpeg"
    });
  });

  it("uses poster artwork next to local videos", async () => {
    const rootPath = await createTempDir();
    await writeFile(path.join(rootPath, "movie.mpg"), "fake mpg");
    await writeFile(path.join(rootPath, "movie.png"), "fake poster");

    const manager = new LocalMediaSourceManager({
      roots: [{ id: "videos", displayName: "Videos", path: rootPath, enabled: true }],
      enableFfprobe: false
    });

    const item = (await manager.list()).items[0];
    expect(item).toBeDefined();
    if (!item) {
      throw new Error("Expected one local video item.");
    }
    expect(item.videoFile?.thumbnailUrl).toBe(item.artworkUrl);
    await expect(manager.resolveArtworkPath(item.id)).resolves.toMatchObject({
      absolutePath: path.join(rootPath, "movie.png"),
      mimeType: "image/png"
    });
  });
});

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "discstream-local-media-"));
  tempDirs.push(tempDir);
  return tempDir;
}
