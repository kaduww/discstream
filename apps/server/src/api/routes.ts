import fs from "node:fs";
import fsp from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createSessionRequestSchema,
  makeError,
  type DiscInspection,
  type DriveStatus,
  type HealthResponse
} from "@discstream/contracts";
import type { LocalMediaSourceManager } from "@discstream/local-media";
import type { PlatformAdapter, RuntimePaths } from "@discstream/platform";
import { applyAudioCdMetadata, audioCdTocFromDisc, type AudioCdMetadataStore } from "../config/audio-cd-metadata-store.js";
import { lookupAudioCdMetadata } from "../config/audio-cd-metadata-lookup.js";
import type { DvdMetadataStore } from "../config/dvd-metadata-store.js";
import type { LocalMediaRootStore } from "../config/local-media-root-store.js";
import type { ServerFolderBrowser } from "../config/server-folder-browser.js";
import { buildRuntimeStatus } from "./runtime-status.js";
import type { RuntimeStatusBroadcaster } from "./runtime-websocket.js";
import type { SessionManager } from "../sessions/session-manager.js";
import type { DiscStreamServerConfig } from "../config/config.js";
import { buildDiagnosticsWarnings, inspectStreamCache } from "./diagnostics.js";

export interface RouteServices {
  startedAt: string;
  version: string;
  platform: PlatformAdapter;
  localMedia: LocalMediaSourceManager;
  localMediaRoots: LocalMediaRootStore;
  serverFolders: ServerFolderBrowser;
  sessions: SessionManager;
  audioCdMetadata: AudioCdMetadataStore;
  dvdMetadata: DvdMetadataStore;
  config: DiscStreamServerConfig;
  paths: RuntimePaths;
  logFilePath?: string;
  staleStreamsRemovedOnStartup: number;
  runtimeEvents?: RuntimeStatusBroadcaster;
}

const localMediaRootRequestSchema = z.object({
  path: z.string().min(1),
  displayName: z.string().min(1).optional()
});

const localMediaFolderQuerySchema = z.object({
  path: z.string().min(1).optional()
});

const dvdMetadataRequestSchema = z.object({
  titles: z.array(
    z.object({
      id: z.number().int().positive(),
      chapters: z.array(
        z.object({
          number: z.number().int().positive(),
          title: z.string().nullable().optional()
        })
      )
    })
  )
});

const audioCdMetadataLookupRequestSchema = z
  .object({
    refresh: z.boolean().optional()
  })
  .optional();

const audioCdMetadataRequestSchema = z.object({
  albumTitle: z.string().nullable().optional(),
  albumArtist: z.string().nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  musicBrainzReleaseId: z.string().nullable().optional(),
  source: z.enum(["musicbrainz", "manual"]).optional(),
  tracks: z.array(
    z.object({
      number: z.number().int().positive(),
      title: z.string().nullable().optional(),
      artist: z.string().nullable().optional()
    })
  )
});

export function registerRoutes(app: FastifyInstance, services: RouteServices) {
  const health = (): HealthResponse => ({
    ok: true,
    version: services.version,
    startedAt: services.startedAt
  });

  app.get("/api/health", async () => health());

  app.get("/api/capabilities", async () => services.platform.detectCapabilities());

  app.get("/api/drives", async () => ({
    drives: await services.platform.detectOpticalDrives()
  }));

  app.get("/api/drive", async () => currentDriveStatus(services.platform));

  app.post("/api/drive/eject", async () => {
    const drives = await services.platform.detectOpticalDrives();
    const drive = drives[0];
    if (!drive) {
      throw makeError("NO_OPTICAL_DRIVE", "No optical drive is available to eject.");
    }

    await services.platform.eject(drive.id);
    services.runtimeEvents?.notify();
    return { ok: true };
  });

  app.get("/api/disc", async () =>
    currentDiscInspection(services.platform, {
      audioCdMetadata: services.audioCdMetadata,
      dvdMetadata: services.dvdMetadata
    })
  );

  app.get("/api/runtime", async () =>
    buildRuntimeStatus(services.platform, services.sessions, {
      audioCdMetadata: services.audioCdMetadata,
      dvdMetadata: services.dvdMetadata
    })
  );

  app.post("/api/audio-cd-metadata/current/lookup", async (request) => {
    const parsed = audioCdMetadataLookupRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw makeError("VALIDATION_ERROR", "Audio CD metadata request is invalid.", {
        detail: parsed.error.message
      });
    }

    const drives = await services.platform.detectOpticalDrives();
    const drive = drives[0];
    if (!drive) {
      throw makeError("NO_OPTICAL_DRIVE", "No optical drive is available for Audio CD metadata lookup.");
    }

    const disc = await services.platform.inspectInsertedMedia(drive.id);
    if (disc.type === "none") {
      throw makeError("NO_DISC", "Insert an Audio CD before looking up metadata.");
    }

    if (disc.type !== "audio-cd") {
      throw makeError("UNSUPPORTED_MEDIA_FORMAT", "Metadata lookup is available for Audio CDs.", {
        hint: "Insert an Audio CD, then try again."
      });
    }

    const cached = parsed.data?.refresh ? null : await services.audioCdMetadata.getForDisc(disc);
    if (cached) {
      const updatedDisc = applyAudioCdMetadata(disc, cached, "cache");
      services.runtimeEvents?.notify();
      return {
        disc: updatedDisc,
        metadata: cached,
        candidates: [],
        cached: true,
        candidateCount: 0
      };
    }

    try {
      const lookup = await lookupAudioCdMetadata({
        disc,
        devicePath: drive.systemDevice
      });
      const metadata = await services.audioCdMetadata.saveForDisc(disc, lookup.metadata);
      const updatedDisc = applyAudioCdMetadata(disc, metadata, "musicbrainz");
      services.runtimeEvents?.notify();
      return {
        disc: updatedDisc,
        metadata,
        candidates: lookup.candidates,
        cached: false,
        candidateCount: lookup.candidateCount
      };
    } catch (error) {
      throw makeError("METADATA_LOOKUP_FAILED", "Audio CD metadata could not be found right now.", {
        detail: error instanceof Error ? error.message : undefined,
        hint: "Check the server internet connection, or try again later."
      });
    }
  });

  app.put("/api/audio-cd-metadata/current", async (request) => {
    const parsed = audioCdMetadataRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw makeError("VALIDATION_ERROR", "Audio CD metadata request is invalid.", {
        detail: parsed.error.message
      });
    }

    const drives = await services.platform.detectOpticalDrives();
    const drive = drives[0];
    if (!drive) {
      throw makeError("NO_OPTICAL_DRIVE", "No optical drive is available for Audio CD metadata.");
    }

    const disc = await services.platform.inspectInsertedMedia(drive.id);
    if (disc.type === "none") {
      throw makeError("NO_DISC", "Insert an Audio CD before saving metadata.");
    }

    if (disc.type !== "audio-cd") {
      throw makeError("UNSUPPORTED_MEDIA_FORMAT", "Audio CD metadata can only be saved for Audio CDs.");
    }

    const source = parsed.data.source ?? "manual";
    const metadata = await services.audioCdMetadata.saveForDisc(disc, {
      discId: disc.audioCd?.discId,
      toc: audioCdTocFromDisc(disc) ?? undefined,
      albumTitle: parsed.data.albumTitle ?? undefined,
      albumArtist: parsed.data.albumArtist ?? undefined,
      coverUrl: parsed.data.coverUrl ?? undefined,
      musicBrainzReleaseId: parsed.data.musicBrainzReleaseId ?? undefined,
      tracks: parsed.data.tracks.map((track) => ({
        number: track.number,
        title: track.title ?? undefined,
        artist: track.artist ?? undefined
      })),
      source
    });
    const updatedDisc = applyAudioCdMetadata(disc, metadata, source);
    services.runtimeEvents?.notify();
    return {
      disc: updatedDisc,
      metadata
    };
  });

  app.put("/api/dvd-metadata/current", async (request) => {
    const parsed = dvdMetadataRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw makeError("VALIDATION_ERROR", "DVD metadata request is invalid.", {
        detail: parsed.error.message
      });
    }

    const disc = await currentDiscInspection(services.platform);
    if (disc.type === "none") {
      throw makeError("NO_DISC", "Insert a DVD before saving chapter names.");
    }

    if (disc.type !== "dvd-video") {
      throw makeError("UNSUPPORTED_MEDIA_FORMAT", "Chapter names can only be saved for DVD-Video discs.");
    }

    const metadata = await services.dvdMetadata.saveForDisc(disc, parsed.data);
    const updatedDisc = await services.dvdMetadata.applyToDisc(disc);
    services.runtimeEvents?.notify();
    return {
      disc: updatedDisc,
      metadata
    };
  });

  app.get("/api/local-media", async () => services.localMedia.list());

  app.get("/api/local-media/roots", async () => ({
    roots: services.localMedia.listRoots()
  }));

  app.get("/api/local-media/folders", async (request) => {
    const parsed = localMediaFolderQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw makeError("VALIDATION_ERROR", "Folder browser request is invalid.", {
        detail: parsed.error.message
      });
    }

    return services.serverFolders.list(parsed.data.path);
  });

  app.post("/api/local-media/roots", async (request) => {
    const parsed = localMediaRootRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw makeError("VALIDATION_ERROR", "Local media folder request is invalid.", {
        detail: parsed.error.message
      });
    }

    try {
      const roots = await services.localMediaRoots.addRoot(parsed.data.path, parsed.data.displayName);
      services.localMedia.setRoots(roots);
      return services.localMedia.list();
    } catch (error) {
      throw makeError("LOCAL_MEDIA_ROOT_UNAVAILABLE", "This local media folder is not available.", {
        detail: error instanceof Error ? error.message : undefined,
        hint: "Use a folder path that exists on the DiscStream server."
      });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/local-media/roots/:id", async (request) => {
    const roots = await services.localMediaRoots.removeRoot(request.params.id);
    services.localMedia.setRoots(roots);
    return services.localMedia.list();
  });

  app.get<{ Params: { id: string } }>("/api/local-media/:id", async (request) => {
    const item = await services.localMedia.getItem(request.params.id);
    if (!item) {
      throw makeError("MEDIA_NOT_READABLE", "This local media item is not available.");
    }

    return item;
  });

  app.get<{ Params: { id: string } }>("/api/local-media/:id/artwork", async (request, reply) => {
    const artwork = await services.localMedia.resolveArtworkPath(request.params.id);
    if (!artwork) {
      throw makeError("MEDIA_NOT_READABLE", "Artwork is not available for this local media item.");
    }

    reply.header("Content-Type", artwork.mimeType);
    reply.header("Cache-Control", "private, max-age=3600");
    return fs.createReadStream(artwork.absolutePath);
  });

  app.get<{ Params: { id: string } }>("/api/local-media/:id/stream", async (request, reply) => {
    const resolved = await services.localMedia.resolveItemPath(request.params.id);
    if (!resolved) {
      throw makeError("MEDIA_NOT_READABLE", "This local media item is not available.");
    }

    const { item, absolutePath } = resolved;
    if (item.mediaType !== "audio-file" && item.mediaType !== "video-file") {
      throw makeError("UNSUPPORTED_MEDIA_FORMAT", "This local media item is not directly streamable yet.");
    }

    const stat = await fsp.stat(absolutePath);
    const rangeHeader = request.headers.range;
    const contentType = item.mimeType ?? "application/octet-stream";

    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", contentType);

    if (!rangeHeader) {
      reply.header("Content-Length", stat.size.toString());
      return fs.createReadStream(absolutePath);
    }

    const range = parseRange(rangeHeader, stat.size);
    if (!range) {
      reply.status(416).header("Content-Range", `bytes */${stat.size}`);
      return "";
    }

    reply.status(206);
    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    reply.header("Content-Length", (range.end - range.start + 1).toString());
    return fs.createReadStream(absolutePath, range);
  });

  app.post("/api/sessions", async (request) => {
    const parsed = createSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw makeError("VALIDATION_ERROR", "Session request is invalid.", {
        detail: parsed.error.message
      });
    }

    const session = await services.sessions.create(parsed.data);
    services.runtimeEvents?.notify();
    return session;
  });

  app.get("/api/sessions/current", async () => ({
    session: services.sessions.current
  }));

  app.get<{ Params: { id: string } }>("/api/sessions/:id/audio", async (request, reply) => {
    const running = await services.sessions.openAudioCdStream(request.params.id);
    reply.header("Content-Type", running.contentType);
    reply.header("Cache-Control", "no-store");
    reply.raw.once("close", () => {
      void running.stop();
    });
    return running.stream;
  });

  app.post("/api/sessions/current/stop", async () => {
    const session = await services.sessions.stop();
    services.runtimeEvents?.notify();
    return {
      ok: true,
      status: session.status
    };
  });

  app.get("/api/diagnostics", async () => {
    const [capabilities, drives, drive, disc, localMedia] = await Promise.all([
      services.platform.detectCapabilities(),
      services.platform.detectOpticalDrives().then((items) => ({ drives: items })),
      currentDriveStatus(services.platform),
      currentDiscInspection(services.platform, {
        audioCdMetadata: services.audioCdMetadata,
        dvdMetadata: services.dvdMetadata
      }),
      services.localMedia.list()
    ]);
    const streamCache = await inspectStreamCache(services.paths.streamsDir);

    return {
      health: health(),
      capabilities,
      drives,
      currentDrive: drive,
      disc,
      localMedia,
      runtime: {
        paths: services.paths,
        streamCache,
        staleStreamsRemovedOnStartup: services.staleStreamsRemovedOnStartup,
        logging: {
          level: services.config.logging.level,
          filePath: services.logFilePath
        }
      },
      configuration: {
        server: services.config.server,
        drives: services.config.drives,
        localMedia: {
          rootCount: localMedia.roots.length,
          browseRootCount: services.config.localMedia.browseRoots.length,
          includeExtensions: services.config.localMedia.includeExtensions
        }
      },
      warnings: buildDiagnosticsWarnings({
        capabilities,
        currentDrive: drive,
        disc,
        localMedia,
        streamCache,
        logFilePath: services.logFilePath
      }),
      lastSessionError: services.sessions.lastError
    };
  });
}

async function currentDriveStatus(platform: PlatformAdapter): Promise<DriveStatus> {
  const drives = await platform.detectOpticalDrives();
  const drive = drives[0];
  if (!drive) {
    return {
      driveId: "none",
      status: "no-drive",
      mediaPresent: false,
      error: makeError("NO_OPTICAL_DRIVE", "No optical drive detected.", {
        hint: "Connect a USB CD/DVD drive or use local media."
      })
    };
  }

  return platform.getDriveStatus(drive.id);
}

async function currentDiscInspection(
  platform: PlatformAdapter,
  metadata: { audioCdMetadata?: AudioCdMetadataStore; dvdMetadata?: DvdMetadataStore } = {}
): Promise<DiscInspection> {
  const drives = await platform.detectOpticalDrives();
  const drive = drives[0];
  if (!drive) {
    return {
      driveId: "none",
      type: "none",
      warnings: [
        {
          code: "NO_OPTICAL_DRIVE",
          message: "No optical drive detected.",
          severity: "info",
          hint: "Connect a drive or choose local media."
        }
      ],
      inspectedAt: new Date().toISOString()
    };
  }

  const disc = await platform.inspectInsertedMedia(drive.id);
  const withDvdMetadata = metadata.dvdMetadata ? await metadata.dvdMetadata.applyToDisc(disc) : disc;
  return metadata.audioCdMetadata ? metadata.audioCdMetadata.applyToDisc(withDvdMetadata) : withDvdMetadata;
}

function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return null;
  }

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  const start = startText ? Number.parseInt(startText, 10) : 0;
  const end = endText ? Number.parseInt(endText, 10) : size - 1;

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= size) {
    return null;
  }

  return { start, end };
}
