import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureInsideRoot } from "./path-allowlist.js";

describe("ensureInsideRoot", () => {
  it("allows paths inside the configured root", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "discstream-root-"));
    await writeFile(path.join(rootPath, "track.mp3"), "fake");

    await expect(
      ensureInsideRoot({ id: "root-1", displayName: "Music", path: rootPath, enabled: true }, "track.mp3")
    ).resolves.toBe(path.join(rootPath, "track.mp3"));
  });

  it("rejects path traversal outside the configured root", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "discstream-root-"));

    await expect(
      ensureInsideRoot({ id: "root-1", displayName: "Music", path: rootPath, enabled: true }, "../secret.mp3")
    ).rejects.toMatchObject({
      code: "MEDIA_PATH_NOT_ALLOWED"
    });
  });
});
