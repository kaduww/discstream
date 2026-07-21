import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  currentSessionResponseSchema,
  diagnosticsResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  localMediaResponseSchema,
  stopSessionResponseSchema,
  type DiscInspection,
  type DriveStatus,
  type PlatformCapabilities,
  type PlaybackSession
} from "@discstream/contracts";
import { LocalMediaSourceManager } from "@discstream/local-media";
import type { PlatformAdapter, RuntimePaths } from "@discstream/platform";
import { registerErrorHandler } from "./errors.js";
import { registerJsonBodyParser } from "./json-parser.js";
import { registerRoutes, type RouteServices } from "./routes.js";
import type { AudioCdMetadataStore } from "../config/audio-cd-metadata-store.js";
import type { DiscStreamServerConfig } from "../config/config.js";
import type { DvdMetadataStore } from "../config/dvd-metadata-store.js";
import type { LocalMediaRootStore } from "../config/local-media-root-store.js";
import type { ServerFolderBrowser } from "../config/server-folder-browser.js";
import type { SessionManager } from "../sessions/session-manager.js";

describe("API routes", () => {
  it("returns typed health, session, and diagnostics responses", async () => {
    const streamsDir = await fs.mkdtemp(path.join(os.tmpdir(), "discstream-routes-streams-"));
    await fs.mkdir(path.join(streamsDir, "73303000-c4df-4132-aaac-766c2f5f8ec0"), { recursive: true });
    await fs.writeFile(path.join(streamsDir, "73303000-c4df-4132-aaac-766c2f5f8ec0", "master.m3u8"), "#EXTM3U");

    const app = await buildRouteTestApp({ paths: testRuntimePaths(streamsDir) });
    try {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(healthResponseSchema.parse(health.json())).toMatchObject({ ok: true, version: "test" });

      const session = await app.inject({ method: "GET", url: "/api/sessions/current" });
      expect(session.statusCode).toBe(200);
      expect(currentSessionResponseSchema.parse(session.json()).session).toBeNull();

      const diagnostics = await app.inject({ method: "GET", url: "/api/diagnostics" });
      expect(diagnostics.statusCode).toBe(200);
      const parsed = diagnosticsResponseSchema.parse(diagnostics.json());
      expect(parsed.runtime.streamCache.directoryCount).toBe(1);
      expect(parsed.runtime.streamCache.fileCount).toBe(1);
      expect(parsed.runtime.streamCache.ffmpegLogCount).toBe(0);
      expect(parsed.warnings.map((warning) => warning.code)).toEqual(
        expect.arrayContaining(["NO_OPTICAL_DRIVE", "LOCAL_MEDIA_NOT_CONFIGURED", "LOG_FILE_NOT_CONFIGURED"])
      );
    } finally {
      await app.close();
      await fs.rm(streamsDir, { recursive: true, force: true });
    }
  });

  it("maps invalid session requests to structured validation errors", async () => {
    const streamsDir = await fs.mkdtemp(path.join(os.tmpdir(), "discstream-routes-streams-"));
    const app = await buildRouteTestApp({ paths: testRuntimePaths(streamsDir) });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: {
          mediaType: "laserdisc"
        }
      });

      expect(response.statusCode).toBe(400);
      expect(errorResponseSchema.parse(response.json()).error.code).toBe("VALIDATION_ERROR");
    } finally {
      await app.close();
      await fs.rm(streamsDir, { recursive: true, force: true });
    }
  });

  it("accepts empty JSON bodies for action endpoints without payloads", async () => {
    const streamsDir = await fs.mkdtemp(path.join(os.tmpdir(), "discstream-routes-streams-"));
    const app = await buildRouteTestApp({ paths: testRuntimePaths(streamsDir) });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/sessions/current/stop",
        headers: {
          "content-type": "application/json"
        },
        payload: ""
      });

      expect(response.statusCode).toBe(200);
      expect(stopSessionResponseSchema.parse(response.json()).status).toBe("stopped");
    } finally {
      await app.close();
      await fs.rm(streamsDir, { recursive: true, force: true });
    }
  });

  it("serves configured local media artwork without exposing server paths", async () => {
    const streamsDir = await fs.mkdtemp(path.join(os.tmpdir(), "discstream-routes-streams-"));
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "discstream-routes-media-"));
    await fs.writeFile(path.join(rootPath, "track.mp3"), "fake mp3");
    await fs.writeFile(path.join(rootPath, "cover.png"), "fake cover");

    const localMedia = new LocalMediaSourceManager({
      roots: [{ id: "music", displayName: "Music", path: rootPath, enabled: true }],
      enableFfprobe: false
    });
    const app = await buildRouteTestApp({ paths: testRuntimePaths(streamsDir), localMedia });
    try {
      const listing = await app.inject({ method: "GET", url: "/api/local-media" });
      expect(listing.statusCode).toBe(200);
      const item = localMediaResponseSchema.parse(listing.json()).items[0];
      expect(item).toBeDefined();
      if (!item) {
        throw new Error("Expected one local media item.");
      }
      expect(item.artworkUrl).toMatch(/^\/api\/local-media\/media-[a-f0-9]+\/artwork$/);
      expect(item.artworkUrl).not.toContain(rootPath);

      const artwork = await app.inject({ method: "GET", url: item.artworkUrl! });
      expect(artwork.statusCode).toBe(200);
      expect(artwork.headers["content-type"]).toBe("image/png");
      expect(artwork.body).toBe("fake cover");
    } finally {
      await app.close();
      await fs.rm(streamsDir, { recursive: true, force: true });
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("saves manual Audio CD metadata for the current disc", async () => {
    const streamsDir = await fs.mkdtemp(path.join(os.tmpdir(), "discstream-routes-streams-"));
    const paths = testRuntimePaths(streamsDir);
    const app = await buildRouteTestApp({
      paths,
      platform: testAudioCdPlatform(paths),
      audioCdMetadata: new TestAudioCdMetadataStore() as unknown as AudioCdMetadataStore
    });
    try {
      const response = await app.inject({
        method: "PUT",
        url: "/api/audio-cd-metadata/current",
        payload: {
          albumTitle: "Manual Album",
          albumArtist: "Manual Artist",
          source: "manual",
          tracks: [
            {
              number: 1,
              title: "Manual Track",
              artist: "Manual Artist"
            }
          ]
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().disc.audioCd).toMatchObject({
        albumTitle: "Manual Album",
        albumArtist: "Manual Artist",
        metadataSource: "manual",
        tracks: [
          {
            number: 1,
            title: "Manual Track",
            artist: "Manual Artist"
          }
        ]
      });
    } finally {
      await app.close();
      await fs.rm(streamsDir, { recursive: true, force: true });
    }
  });
});

async function buildRouteTestApp(overrides: Partial<RouteServices> = {}) {
  const app = Fastify({ logger: false });
  registerJsonBodyParser(app);
  registerErrorHandler(app);
  registerRoutes(app, {
    startedAt: "2026-07-21T00:00:00.000Z",
    version: "test",
    platform: testPlatform(overrides.paths ?? testRuntimePaths("/tmp/discstream-test-streams")),
    localMedia: new LocalMediaSourceManager({ roots: [], enableFfprobe: false }),
    localMediaRoots: testLocalMediaRootStore(),
    serverFolders: testServerFolderBrowser(),
    sessions: testSessions(),
    audioCdMetadata: testAudioCdMetadata(),
    dvdMetadata: testDvdMetadata(),
    config: testConfig(),
    paths: testRuntimePaths("/tmp/discstream-test-streams"),
    staleStreamsRemovedOnStartup: 0,
    ...overrides
  });
  await app.ready();
  return app;
}

function testRuntimePaths(streamsDir: string): RuntimePaths {
  const base = path.dirname(streamsDir);
  return {
    configDir: path.join(base, "config"),
    dataDir: path.join(base, "data"),
    cacheDir: path.join(base, "cache"),
    logDir: path.join(base, "logs"),
    streamsDir,
    coversDir: path.join(base, "covers")
  };
}

function testConfig(): DiscStreamServerConfig {
  return {
    server: {
      host: "127.0.0.1",
      port: 7373
    },
    drives: {
      pollingIntervalMs: 2000
    },
    localMedia: {
      roots: [],
      browseRoots: [],
      includeExtensions: [".mp3", ".mp4"]
    },
    logging: {
      level: "silent"
    }
  };
}

function testPlatform(paths: RuntimePaths): PlatformAdapter {
  const noDriveStatus: DriveStatus = {
    driveId: "none",
    status: "no-drive",
    mediaPresent: false,
    error: {
      code: "NO_OPTICAL_DRIVE",
      message: "No optical drive detected.",
      recoverable: true
    }
  };
  const noDisc: DiscInspection = {
    driveId: "none",
    type: "none",
    warnings: [],
    inspectedAt: "2026-07-21T00:00:00.000Z"
  };

  return {
    platform: "darwin",
    displayName: "Test macOS",
    detectCapabilities: async () => testCapabilities(paths),
    detectOpticalDrives: async () => [],
    getDriveStatus: async () => noDriveStatus,
    inspectInsertedMedia: async () => noDisc,
    eject: async () => undefined,
    closeTray: async () => undefined,
    mount: async () => null,
    unmount: async () => undefined,
    watchDrives: async () => ({
      close() {
        return;
      }
    })
  };
}

function testAudioCdPlatform(paths: RuntimePaths): PlatformAdapter {
  const disc: DiscInspection = {
    driveId: "drive-0",
    type: "audio-cd",
    label: "Audio CD",
    audioCd: {
      tracks: [
        {
          number: 1,
          durationSeconds: 180
        }
      ],
      metadataSource: "none"
    },
    warnings: [],
    inspectedAt: "2026-07-21T00:00:00.000Z"
  };

  return {
    ...testPlatform(paths),
    detectOpticalDrives: async () => [
      {
        id: "drive-0",
        systemDevice: "drutil",
        displayName: "Test Drive",
        transport: "unknown",
        capabilities: {
          audioCd: true,
          dvdVideo: true,
          eject: true,
          closeTray: true
        }
      }
    ],
    inspectInsertedMedia: async () => disc
  };
}

function testCapabilities(paths: RuntimePaths): PlatformCapabilities {
  return {
    platform: "darwin",
    platformVersion: "test",
    architecture: "arm64",
    commands: {
      ffmpeg: true,
      ffprobe: true,
      cdparanoia: false,
      cdInfo: false,
      discid: false,
      dvdbackup: false,
      lsdvd: false,
      eject: false,
      lsblk: false,
      udevadm: false,
      udisksctl: false,
      diskutil: true,
      drutil: true,
      ioreg: true
    },
    videoEncoders: {
      libx264: true,
      h264VideoToolbox: false,
      h264V4l2m2m: false
    },
    audioEncoders: {
      aac: true,
      libmp3lame: true,
      flac: true
    },
    opticalDrives: 0,
    paths
  };
}

function testSessions(): SessionManager {
  const stopped: PlaybackSession = {
    sessionId: "idle",
    status: "stopped",
    mediaType: "local-audio",
    stoppedAt: "2026-07-21T00:00:00.000Z"
  };

  return {
    current: null,
    lastError: undefined,
    create: async () => stopped,
    stop: async () => stopped,
    openAudioCdStream: async () => {
      throw new Error("not implemented in route tests");
    }
  } as unknown as SessionManager;
}

function testLocalMediaRootStore(): LocalMediaRootStore {
  return {
    addRoot: async () => [],
    removeRoot: async () => []
  } as unknown as LocalMediaRootStore;
}

function testServerFolderBrowser(): ServerFolderBrowser {
  return {
    list: async () => ({
      roots: [],
      currentPath: "/",
      parentPath: null,
      directories: []
    })
  } as unknown as ServerFolderBrowser;
}

function testAudioCdMetadata(): AudioCdMetadataStore {
  return {
    applyToDisc: (disc: DiscInspection) => disc,
    getForDisc: async () => null,
    saveForDisc: async (_disc: DiscInspection, metadata: unknown) => metadata
  } as unknown as AudioCdMetadataStore;
}

class TestAudioCdMetadataStore {
  async applyToDisc(disc: DiscInspection) {
    return disc;
  }

  async getForDisc() {
    return null;
  }

  async saveForDisc(_disc: DiscInspection, metadata: unknown) {
    return {
      discKey: "test-disc",
      ...(metadata as object),
      updatedAt: "2026-07-21T00:00:00.000Z"
    };
  }
}

function testDvdMetadata(): DvdMetadataStore {
  return {
    applyToDisc: async (disc: DiscInspection) => disc,
    saveForDisc: async () => ({})
  } as unknown as DvdMetadataStore;
}
