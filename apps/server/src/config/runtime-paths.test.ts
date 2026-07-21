import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimePaths } from "./runtime-paths.js";

describe("resolveRuntimePaths", () => {
  it("creates repo-local runtime directories by default", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "discstream-runtime-default-"));
    try {
      const paths = await resolveRuntimePaths(cwd, {});

      expect(paths).toEqual({
        configDir: path.join(cwd, "runtime", "config"),
        dataDir: path.join(cwd, "runtime", "data"),
        cacheDir: path.join(cwd, "runtime", "cache"),
        logDir: path.join(cwd, "runtime", "logs"),
        streamsDir: path.join(cwd, "runtime", "streams"),
        coversDir: path.join(cwd, "runtime", "covers")
      });
      expect((await fs.stat(paths.configDir)).isDirectory()).toBe(true);
      expect((await fs.stat(paths.coversDir)).isDirectory()).toBe(true);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("uses install runtime overrides when configured", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "discstream-runtime-cwd-"));
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "discstream-runtime-install-"));
    const logDir = path.join(runtimeDir, "custom-logs");
    try {
      const paths = await resolveRuntimePaths(cwd, {
        DISCSTREAM_RUNTIME_DIR: runtimeDir,
        DISCSTREAM_LOG_DIR: logDir
      });

      expect(paths.configDir).toBe(path.join(runtimeDir, "config"));
      expect(paths.logDir).toBe(logDir);
      expect(paths.streamsDir).toBe(path.join(runtimeDir, "streams"));
      expect((await fs.stat(logDir)).isDirectory()).toBe(true);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
  });
});
