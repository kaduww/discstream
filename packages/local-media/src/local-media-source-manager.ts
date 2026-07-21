import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { LocalMediaItem, LocalMediaResponse, LocalMediaRoot } from "@discstream/contracts";
import { makeError } from "@discstream/contracts";
import { probeLocalMedia, type LocalMediaProbe } from "./ffprobe.js";
import type { AllowedRoot } from "./path-allowlist.js";
import { canReadRoot, ensureInsideRoot, normalizeRoot } from "./path-allowlist.js";
import { audioMetadataFor, classifyLocalPath, mimeTypeFor, supportedExtensions, videoMetadataFor } from "./metadata-probe.js";

export interface LocalMediaRootConfig {
  id?: string;
  displayName: string;
  path: string;
  enabled: boolean;
}

export interface LocalMediaSourceManagerOptions {
  roots: LocalMediaRootConfig[];
  includeExtensions?: string[];
  maxDepth?: number;
  maxItems?: number;
  enableFfprobe?: boolean;
  ffprobeTimeoutMs?: number;
}

interface InternalItem extends LocalMediaItem {
  absolutePath: string;
  artworkPath?: string;
  artworkMimeType?: string;
}

export interface LocalMediaArtwork {
  absolutePath: string;
  mimeType: string;
}

export class LocalMediaSourceManager {
  private roots: AllowedRoot[];
  private readonly includeExtensions: Set<string>;
  private readonly maxDepth: number;
  private readonly maxItems: number;
  private readonly enableFfprobe: boolean;
  private readonly ffprobeTimeoutMs: number;
  private readonly probeCache = new Map<string, LocalMediaProbe | null>();

  constructor(options: LocalMediaSourceManagerOptions) {
    this.roots = options.roots.map((root) => ({
      id: root.id ?? stableId("root", root.path),
      displayName: root.displayName,
      path: path.resolve(root.path),
      enabled: root.enabled
    }));
    this.includeExtensions = new Set(
      (options.includeExtensions?.length ? options.includeExtensions : supportedExtensions()).map((extension) =>
        extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`
      )
    );
    this.maxDepth = options.maxDepth ?? 4;
    this.maxItems = options.maxItems ?? 500;
    this.enableFfprobe = options.enableFfprobe ?? true;
    this.ffprobeTimeoutMs = options.ffprobeTimeoutMs ?? 2500;
  }

  setRoots(roots: LocalMediaRootConfig[]): void {
    this.roots = roots.map((root) => ({
      id: root.id ?? stableId("root", root.path),
      displayName: root.displayName,
      path: path.resolve(root.path),
      enabled: root.enabled
    }));
    this.probeCache.clear();
  }

  listRoots(): LocalMediaRoot[] {
    return this.roots.map(toPublicRoot);
  }

  async list(): Promise<LocalMediaResponse> {
    const roots = this.roots.map(toPublicRoot);
    const items: LocalMediaItem[] = [];

    for (const root of this.roots) {
      if (!root.enabled || !(await canReadRoot(root))) {
        continue;
      }

      const normalizedRoot = await normalizeRoot(root);
      const scanned = await this.scanRoot(normalizedRoot);
      items.push(...scanned.map(toPublicItem));

      if (items.length >= this.maxItems) {
        break;
      }
    }

    return { roots, items };
  }

  async getItem(id: string): Promise<LocalMediaItem | null> {
    const internal = await this.getInternalItem(id);
    return internal ? toPublicItem(internal) : null;
  }

  async resolveItemPath(id: string): Promise<{ item: LocalMediaItem; absolutePath: string } | null> {
    const internal = await this.getInternalItem(id);
    if (!internal) {
      return null;
    }

    const root = this.roots.find((candidate) => candidate.id === internal.rootId);
    if (!root) {
      return null;
    }

    const absolutePath = await ensureInsideRoot(root, internal.relativePath);
    return {
      item: toPublicItem(internal),
      absolutePath
    };
  }

  async resolveArtworkPath(id: string): Promise<LocalMediaArtwork | null> {
    const internal = await this.getInternalItem(id);
    if (!internal?.artworkPath || !internal.artworkMimeType) {
      return null;
    }

    const root = this.roots.find((candidate) => candidate.id === internal.rootId);
    if (!root) {
      return null;
    }

    const relativeArtworkPath = path.relative(root.path, internal.artworkPath);
    const absolutePath = await ensureInsideRoot(root, relativeArtworkPath);
    return {
      absolutePath,
      mimeType: internal.artworkMimeType
    };
  }

  private async getInternalItem(id: string): Promise<InternalItem | null> {
    for (const root of this.roots) {
      if (!root.enabled || !(await canReadRoot(root))) {
        continue;
      }

      const normalizedRoot = await normalizeRoot(root);
      const items = await this.scanRoot(normalizedRoot);
      const found = items.find((item) => item.id === id);
      if (found) {
        return found;
      }
    }

    return null;
  }

  private async scanRoot(root: AllowedRoot): Promise<InternalItem[]> {
    const output: InternalItem[] = [];

    await this.walk(root, root.path, 0, output);
    return output.slice(0, this.maxItems);
  }

  private async walk(root: AllowedRoot, currentPath: string, depth: number, output: InternalItem[]): Promise<void> {
    if (depth > this.maxDepth || output.length >= this.maxItems) {
      return;
    }

    let entries: string[];
    try {
      entries = await fs.readdir(currentPath);
    } catch {
      return;
    }

    for (const entry of entries.sort((left, right) => left.localeCompare(right))) {
      if (output.length >= this.maxItems) {
        return;
      }

      const absolutePath = path.join(currentPath, entry);
      let stat;
      try {
        stat = await fs.stat(absolutePath);
      } catch {
        continue;
      }

      const mediaType = classifyLocalPath(absolutePath, stat.isDirectory());
      if (mediaType !== "unknown") {
        if (!stat.isDirectory() && !this.includeExtensions.has(path.extname(absolutePath).toLowerCase())) {
          continue;
        }

        output.push(await this.createItem(root, absolutePath, stat.size, stat.mtimeMs, mediaType));
      }

      if (stat.isDirectory()) {
        await this.walk(root, absolutePath, depth + 1, output);
      }
    }
  }

  private async createItem(
    root: AllowedRoot,
    absolutePath: string,
    sizeBytes: number,
    mtimeMs: number,
    mediaType: LocalMediaItem["mediaType"]
  ): Promise<InternalItem> {
    const relativePath = path.relative(root.path, absolutePath);
    const id = stableId("media", `${root.id}:${relativePath}`);
    const probe = await this.probeFor(absolutePath, sizeBytes, mtimeMs, mediaType);
    const artwork = await findArtworkForLocalMedia(absolutePath, mediaType);
    const artworkUrl = artwork ? `/api/local-media/${encodeURIComponent(id)}/artwork` : undefined;
    const audioMetadata = mediaType === "audio-file" ? audioMetadataFor(absolutePath, probe) : undefined;
    const videoMetadata = mediaType === "video-file" ? videoMetadataFor(absolutePath, probe) : undefined;
    const audioFile = audioMetadata && artworkUrl ? { ...audioMetadata, coverUrl: artworkUrl } : audioMetadata;
    const videoFile = videoMetadata && artworkUrl ? { ...videoMetadata, thumbnailUrl: artworkUrl } : videoMetadata;
    const durationSeconds = audioFile?.durationSeconds ?? videoFile?.durationSeconds;
    const sourceKind = mediaType === "dvd-video-folder" ? "local-folder" : mediaType.endsWith("image") ? "disc-image" : "local-file";
    const baseItem = {
      id,
      rootId: root.id,
      sourceKind,
      mediaType,
      displayName: displayNameForLocalMedia(absolutePath, mediaType),
      relativePath,
      artworkUrl,
      sizeBytes,
      durationSeconds,
      audioFile,
      videoFile,
      warnings: [],
      inspectedAt: new Date().toISOString()
    } satisfies Omit<InternalItem, "mimeType" | "absolutePath" | "artworkPath" | "artworkMimeType">;

    return {
      ...baseItem,
      mimeType: mimeTypeFor(baseItem),
      absolutePath,
      artworkPath: artwork?.absolutePath,
      artworkMimeType: artwork?.mimeType
    };
  }

  private async probeFor(
    absolutePath: string,
    sizeBytes: number,
    mtimeMs: number,
    mediaType: LocalMediaItem["mediaType"]
  ): Promise<LocalMediaProbe | null> {
    if (!this.enableFfprobe || (mediaType !== "audio-file" && mediaType !== "video-file")) {
      return null;
    }

    const cacheKey = `${absolutePath}:${sizeBytes}:${mtimeMs}`;
    if (this.probeCache.has(cacheKey)) {
      return this.probeCache.get(cacheKey) ?? null;
    }

    const probe = await probeLocalMedia(absolutePath, this.ffprobeTimeoutMs);
    this.probeCache.set(cacheKey, probe);
    return probe;
  }
}

export function buildLocalMediaManagerFromEnv(env: NodeJS.ProcessEnv = process.env): LocalMediaSourceManager {
  const rootValue = env.DISCSTREAM_LOCAL_MEDIA_ROOTS?.trim();
  const roots = rootValue
    ? rootValue.split(path.delimiter).filter(Boolean).map((rootPath, index) => ({
        displayName: `Local Media ${index + 1}`,
        path: rootPath,
        enabled: true
      }))
    : [];

  return new LocalMediaSourceManager({
    roots,
    includeExtensions: env.DISCSTREAM_LOCAL_MEDIA_EXTENSIONS?.split(",").map((extension) => extension.trim()).filter(Boolean)
  });
}

function toPublicRoot(root: AllowedRoot): LocalMediaRoot {
  return {
    id: root.id,
    displayName: root.displayName,
    enabled: root.enabled
  };
}

function toPublicItem(item: InternalItem): LocalMediaItem {
  const { absolutePath: _absolutePath, artworkPath: _artworkPath, artworkMimeType: _artworkMimeType, ...publicItem } = item;
  return publicItem;
}

function displayNameForLocalMedia(absolutePath: string, mediaType: LocalMediaItem["mediaType"]): string {
  if (mediaType === "dvd-video-folder") {
    return path.basename(path.dirname(absolutePath));
  }

  return path.basename(absolutePath);
}

function stableId(prefix: string, input: string): string {
  const digest = crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
  return `${prefix}-${digest}`;
}

const artworkExtensions = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);

const sharedArtworkNames = ["cover", "folder", "front", "album", "poster", "thumbnail"];

async function findArtworkForLocalMedia(
  absolutePath: string,
  mediaType: LocalMediaItem["mediaType"]
): Promise<LocalMediaArtwork | undefined> {
  if (mediaType !== "audio-file" && mediaType !== "video-file" && mediaType !== "dvd-video-folder") {
    return undefined;
  }

  const directory = mediaType === "dvd-video-folder" ? path.dirname(absolutePath) : path.dirname(absolutePath);
  const mediaStem =
    mediaType === "dvd-video-folder" ? path.basename(path.dirname(absolutePath)) : path.basename(absolutePath, path.extname(absolutePath));
  const names = [mediaStem, ...sharedArtworkNames];

  return findArtworkInDirectory(directory, names);
}

async function findArtworkInDirectory(directory: string, names: string[]): Promise<LocalMediaArtwork | undefined> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const filesByLowercaseName = new Map(
    entries.filter((entry) => entry.isFile()).map((entry) => [entry.name.toLowerCase(), entry.name])
  );

  for (const name of names) {
    for (const [extension, mimeType] of artworkExtensions) {
      const fileName = filesByLowercaseName.get(`${name}${extension}`.toLowerCase());
      if (fileName) {
        return {
          absolutePath: path.join(directory, fileName),
          mimeType
        };
      }
    }
  }

  return undefined;
}

export function localMediaNotFound(id: string) {
  return makeError("MEDIA_NOT_READABLE", "This local media item is not available.", {
    detail: id,
    hint: "Check that the configured local media folder still exists and is readable."
  });
}
