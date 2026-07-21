import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { errorResponseSchema, healthResponseSchema } from "@discstream/contracts";
import { buildApp } from "./app.js";

const webDistIndex = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist/index.html");
const hasWebBuild = fs.existsSync(webDistIndex);
const previousEnv: Record<string, string | undefined> = {};

describe.skipIf(!hasWebBuild)("packaged app smoke", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("serves the built web UI and structured API responses", async () => {
    const runtimeDir = await fsp.mkdtemp(path.join(os.tmpdir(), "discstream-smoke-runtime-"));
    setEnv({
      DISCSTREAM_RUNTIME_DIR: runtimeDir,
      DISCSTREAM_LOCAL_MEDIA_ROOTS: "",
      DISCSTREAM_LOCAL_MEDIA_BROWSE_ROOTS: runtimeDir,
      LOG_LEVEL: "silent"
    });

    const { app } = await buildApp();
    try {
      const home = await app.inject({ method: "GET", url: "/" });
      expect(home.statusCode).toBe(200);
      expect(home.headers["content-type"]).toContain("text/html");
      expect(home.body).toContain('<div id="root">');

      const deepLink = await app.inject({ method: "GET", url: "/local/some-folder" });
      expect(deepLink.statusCode).toBe(200);
      expect(deepLink.body).toContain('<div id="root">');

      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(healthResponseSchema.parse(health.json()).ok).toBe(true);

      const missingApi = await app.inject({ method: "GET", url: "/api/not-found" });
      expect(missingApi.statusCode).toBe(404);
      expect(errorResponseSchema.parse(missingApi.json()).error.code).toBe("VALIDATION_ERROR");
    } finally {
      await app.close();
      await fsp.rm(runtimeDir, { recursive: true, force: true });
    }
  });
});

function setEnv(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in previousEnv)) {
      previousEnv[key] = process.env[key];
    }
    process.env[key] = value;
  }
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    delete previousEnv[key];
  }
}
