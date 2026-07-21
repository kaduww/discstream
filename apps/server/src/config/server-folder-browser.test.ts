import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ServerFolderBrowser } from "./server-folder-browser.js";

describe("ServerFolderBrowser", () => {
  it("lists directories inside the configured server browse roots", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "discstream-browse-"));
    await mkdir(path.join(rootPath, "Movies"));
    await mkdir(path.join(rootPath, "Music"));

    const browser = new ServerFolderBrowser([rootPath]);
    const listing = await browser.list();
    const realRootPath = await realpath(rootPath);

    expect(listing.currentPath).toBe(realRootPath);
    expect(listing.roots).toEqual([{ displayName: path.basename(realRootPath), path: realRootPath }]);
    expect(listing.directories.map((directory) => directory.name)).toEqual(["Movies", "Music"]);
  });

  it("allows navigation within a browse root and returns the parent", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "discstream-browse-"));
    const moviesPath = path.join(rootPath, "Movies");
    await mkdir(moviesPath);

    const browser = new ServerFolderBrowser([rootPath]);
    const listing = await browser.list(moviesPath);
    const realRootPath = await realpath(rootPath);
    const realMoviesPath = await realpath(moviesPath);

    expect(listing.currentPath).toBe(realMoviesPath);
    expect(listing.parentPath).toBe(realRootPath);
  });

  it("rejects paths outside the configured browse roots", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "discstream-browse-"));
    const outsidePath = await mkdtemp(path.join(os.tmpdir(), "discstream-outside-"));

    const browser = new ServerFolderBrowser([rootPath]);

    await expect(browser.list(outsidePath)).rejects.toMatchObject({
      code: "MEDIA_PATH_NOT_ALLOWED"
    });
  });
});
