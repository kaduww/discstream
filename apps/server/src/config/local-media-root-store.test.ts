import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalMediaRootStore } from "./local-media-root-store.js";

describe("LocalMediaRootStore", () => {
  it("loads env and stored roots with stable ids", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "discstream-roots-"));
    const envRoot = path.join(tempDir, "env");
    const storedRoot = path.join(tempDir, "stored");
    const storeFile = path.join(tempDir, "local-media-roots.json");

    await writeFile(
      storeFile,
      JSON.stringify({
        roots: [
          {
            displayName: "Stored",
            path: storedRoot,
            enabled: true
          }
        ]
      }),
      "utf8"
    );

    const store = new LocalMediaRootStore(storeFile, [
      {
        displayName: "Env",
        path: envRoot,
        enabled: true
      }
    ]);

    const roots = await store.load();

    expect(roots).toHaveLength(2);
    expect(roots.map((root) => root.displayName)).toEqual(["Env", "Stored"]);
    expect(roots.every((root) => root.id?.startsWith("root-"))).toBe(true);
    expect(roots.map((root) => root.path)).toEqual([envRoot, storedRoot].map((rootPath) => path.resolve(rootPath)));
  });

  it("adds and removes persisted local media roots", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "discstream-roots-"));
    const storeFile = path.join(tempDir, "local-media-roots.json");
    const realMediaDir = await mkdtemp(path.join(tempDir, "library-"));

    const store = new LocalMediaRootStore(storeFile, []);
    await store.load();

    const added = await store.addRoot(realMediaDir);

    expect(added).toHaveLength(1);
    expect(added[0]?.displayName).toBe(path.basename(realMediaDir));
    expect(added[0]?.path).toBe(realMediaDir);

    const persisted = JSON.parse(await readFile(storeFile, "utf8")) as { roots: Array<{ path: string }> };
    expect(persisted.roots[0]?.path).toBe(realMediaDir);

    const removed = await store.removeRoot(added[0]!.id!);

    expect(removed).toEqual([]);
  });
});
