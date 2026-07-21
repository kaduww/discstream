import Fastify, { type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalMediaSourceManager } from "@discstream/local-media";
import { createPlatformAdapter } from "@discstream/platform";
import { loadConfig } from "./config/config.js";
import { AudioCdMetadataStore } from "./config/audio-cd-metadata-store.js";
import { DvdMetadataStore } from "./config/dvd-metadata-store.js";
import { LocalMediaRootStore } from "./config/local-media-root-store.js";
import { resolveRuntimePaths } from "./config/runtime-paths.js";
import { ServerFolderBrowser } from "./config/server-folder-browser.js";
import { registerErrorHandler } from "./api/errors.js";
import { registerJsonBodyParser } from "./api/json-parser.js";
import { registerRoutes } from "./api/routes.js";
import { registerRuntimeStatusWebSocket } from "./api/runtime-websocket.js";
import { SessionManager } from "./sessions/session-manager.js";

export async function buildApp() {
  const config = loadConfig();
  const paths = await resolveRuntimePaths();
  const logFilePath = config.logging.filePath ? path.resolve(config.logging.filePath) : undefined;
  if (logFilePath) {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  }

  const app = Fastify({
    logger: {
      level: config.logging.level,
      ...(logFilePath ? { file: logFilePath } : {})
    }
  });

  registerJsonBodyParser(app);

  const localMediaRoots = new LocalMediaRootStore(path.join(paths.configDir, "local-media-roots.json"), config.localMedia.roots);
  const audioCdMetadata = new AudioCdMetadataStore(path.join(paths.dataDir, "audio-cd-metadata.json"));
  const dvdMetadata = new DvdMetadataStore(path.join(paths.dataDir, "dvd-metadata.json"));
  const roots = await localMediaRoots.load();
  const platform = createPlatformAdapter(paths);
  const localMedia = new LocalMediaSourceManager({
    roots,
    includeExtensions: config.localMedia.includeExtensions
  });
  const serverFolders = new ServerFolderBrowser(config.localMedia.browseRoots);
  const sessions = new SessionManager(localMedia, {
    streamsDir: paths.streamsDir,
    detectCapabilities: () => platform.detectCapabilities(),
    detectOpticalDrives: () => platform.detectOpticalDrives(),
    getDriveStatus: (driveId) => platform.getDriveStatus(driveId),
    inspectDisc: async (driveId) => audioCdMetadata.applyToDisc(await dvdMetadata.applyToDisc(await platform.inspectInsertedMedia(driveId)))
  });
  const staleStreamsRemoved = await sessions.cleanupStaleStreams();
  if (staleStreamsRemoved > 0) {
    app.log.info({ removed: staleStreamsRemoved }, "removed stale stream cache directories");
  }
  const runtimeEvents = registerRuntimeStatusWebSocket(app, {
    platform,
    sessions,
    audioCdMetadata,
    dvdMetadata
  });

  registerErrorHandler(app);
  registerRoutes(app, {
    startedAt: new Date().toISOString(),
    version: process.env.npm_package_version ?? "0.1.0",
    platform,
    localMedia,
    localMediaRoots,
    serverFolders,
    sessions,
    audioCdMetadata,
    dvdMetadata,
    config,
    paths,
    logFilePath,
    staleStreamsRemovedOnStartup: staleStreamsRemoved,
    runtimeEvents
  });

  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  const webIndexPath = path.join(webDist, "index.html");
  const hasWebBuild = fs.existsSync(webIndexPath);
  await app.register(fastifyStatic, {
    root: paths.streamsDir,
    prefix: "/streams/",
    decorateReply: false,
    cacheControl: false,
    setHeaders: setStreamHeaders
  });

  if (hasWebBuild) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      decorateReply: false,
      wildcard: false
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.status(404).send({ error: { code: "VALIDATION_ERROR", message: "API route not found.", recoverable: true } });
      return;
    }

    if (hasWebBuild) {
      sendWebIndex(reply, webIndexPath);
      return;
    }

    reply.status(404).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Web build not found. Run the Vite dev server or build the web app.",
        recoverable: true
      }
    });
  });

  return { app, config };
}

function sendWebIndex(reply: FastifyReply, webIndexPath: string): void {
  reply.type("text/html; charset=utf-8").send(fs.createReadStream(webIndexPath));
}

function setStreamHeaders(res: { setHeader(name: string, value: string): void }, filePath: string): void {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".m3u8") {
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  }
  if (extension === ".ts") {
    res.setHeader("Content-Type", "video/mp2t");
  }
  if (extension === ".mp3") {
    res.setHeader("Content-Type", "audio/mpeg");
  }

  res.setHeader("Cache-Control", "no-store");
}
