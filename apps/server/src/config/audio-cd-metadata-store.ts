import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DiscInspection } from "@discstream/contracts";

export interface AudioCdTrackMetadataInput {
  number: number;
  title?: string;
  artist?: string;
}

export interface AudioCdMetadataInput {
  discId?: string;
  toc?: string;
  albumTitle?: string;
  albumArtist?: string;
  coverUrl?: string;
  musicBrainzReleaseId?: string;
  tracks: AudioCdTrackMetadataInput[];
  source: "musicbrainz" | "manual";
}

export interface StoredAudioCdTrackMetadata {
  number: number;
  title?: string;
  artist?: string;
}

export interface StoredAudioCdMetadata {
  discKey: string;
  discId?: string;
  toc?: string;
  albumTitle?: string;
  albumArtist?: string;
  coverUrl?: string;
  musicBrainzReleaseId?: string;
  tracks: StoredAudioCdTrackMetadata[];
  source: "musicbrainz" | "manual";
  updatedAt: string;
}

interface StoredAudioCdMetadataFile {
  discs: Record<string, StoredAudioCdMetadata>;
}

export class AudioCdMetadataStore {
  constructor(private readonly filePath: string) {}

  async getForDisc(disc: DiscInspection): Promise<StoredAudioCdMetadata | null> {
    const discKey = audioCdDiscKey(disc);
    if (!discKey) {
      return null;
    }

    const stored = await this.readStoredMetadata();
    return stored.discs[discKey] ?? null;
  }

  async applyToDisc(disc: DiscInspection, metadataSource: "cache" | "musicbrainz" = "cache"): Promise<DiscInspection> {
    const metadata = await this.getForDisc(disc);
    if (!metadata || disc.type !== "audio-cd" || !disc.audioCd) {
      return disc;
    }

    return applyAudioCdMetadata(disc, metadata, metadataSource);
  }

  async saveForDisc(disc: DiscInspection, input: AudioCdMetadataInput): Promise<StoredAudioCdMetadata> {
    const discKey = audioCdDiscKey(disc);
    if (!discKey || disc.type !== "audio-cd") {
      throw new Error("Audio CD metadata requires an Audio CD.");
    }

    const metadata: StoredAudioCdMetadata = {
      discKey,
      discId: cleanText(input.discId),
      toc: cleanText(input.toc),
      albumTitle: cleanText(input.albumTitle),
      albumArtist: cleanText(input.albumArtist),
      coverUrl: cleanText(input.coverUrl),
      musicBrainzReleaseId: cleanText(input.musicBrainzReleaseId),
      tracks: input.tracks
        .map((track) => ({
          number: track.number,
          title: cleanText(track.title),
          artist: cleanText(track.artist)
        }))
        .filter((track) => Number.isInteger(track.number) && track.number > 0 && (track.title || track.artist))
        .sort((left, right) => left.number - right.number),
      source: input.source,
      updatedAt: new Date().toISOString()
    };

    const stored = await this.readStoredMetadata();
    if (hasUsefulMetadata(metadata)) {
      stored.discs[discKey] = metadata;
    } else {
      delete stored.discs[discKey];
    }

    await this.writeStoredMetadata(stored);
    return metadata;
  }

  private async readStoredMetadata(): Promise<StoredAudioCdMetadataFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredAudioCdMetadataFile>;
      return {
        discs: parsed.discs && typeof parsed.discs === "object" ? filterStoredDiscs(parsed.discs) : {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { discs: {} };
      }

      throw error;
    }
  }

  private async writeStoredMetadata(stored: StoredAudioCdMetadataFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  }
}

export function applyAudioCdMetadata(
  disc: DiscInspection,
  metadata: StoredAudioCdMetadata,
  metadataSource: "cache" | "musicbrainz" | "manual"
): DiscInspection {
  if (disc.type !== "audio-cd" || !disc.audioCd) {
    return disc;
  }

  const trackMetadata = new Map(metadata.tracks.map((track) => [track.number, track]));
  return {
    ...disc,
    label: disc.label ?? metadata.albumTitle,
    audioCd: {
      ...disc.audioCd,
      discId: metadata.discId ?? disc.audioCd.discId,
      albumTitle: metadata.albumTitle ?? disc.audioCd.albumTitle,
      albumArtist: metadata.albumArtist ?? disc.audioCd.albumArtist,
      coverUrl: metadata.coverUrl ?? disc.audioCd.coverUrl,
      tracks: disc.audioCd.tracks.map((track) => {
        const storedTrack = trackMetadata.get(track.number);
        if (!storedTrack) {
          return track;
        }

        return {
          ...track,
          title: storedTrack.title ?? track.title,
          artist: storedTrack.artist ?? track.artist
        };
      }),
      metadataSource
    }
  };
}

export function audioCdDiscKey(disc: DiscInspection): string | null {
  if (disc.type !== "audio-cd" || !disc.audioCd) {
    return null;
  }

  const tracks = [...disc.audioCd.tracks].sort((left, right) => left.number - right.number);
  if (tracks.length > 0) {
    return `audio-cd-${stableDigest({
      trackCount: tracks.length,
      durations: tracks.map((track) => (track.durationSeconds ? Math.round(track.durationSeconds) : null))
    })}`;
  }

  if (disc.audioCd.discId) {
    return `audio-cd-${stableDigest({ discId: disc.audioCd.discId })}`;
  }

  return null;
}

export function audioCdTocFromDisc(disc: DiscInspection): string | null {
  if (disc.type !== "audio-cd" || !disc.audioCd) {
    return null;
  }

  const tracks = [...disc.audioCd.tracks].sort((left, right) => left.number - right.number);
  if (tracks.length === 0 || tracks.some((track) => !track.durationSeconds)) {
    return null;
  }

  const offsets: number[] = [];
  let nextOffset = 150;
  for (const track of tracks) {
    offsets.push(nextOffset);
    nextOffset += Math.max(1, Math.round((track.durationSeconds ?? 0) * 75));
  }

  return [1, tracks.length, nextOffset, ...offsets].join(" ");
}

function stableDigest(value: unknown): string {
  return crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function hasUsefulMetadata(metadata: StoredAudioCdMetadata): boolean {
  return Boolean(metadata.albumTitle || metadata.albumArtist || metadata.coverUrl || metadata.tracks.length);
}

function filterStoredDiscs(discs: Record<string, unknown>): Record<string, StoredAudioCdMetadata> {
  return Object.fromEntries(
    Object.entries(discs).filter((entry): entry is [string, StoredAudioCdMetadata] => isStoredAudioCdMetadata(entry[1]))
  );
}

function isStoredAudioCdMetadata(value: unknown): value is StoredAudioCdMetadata {
  return Boolean(
    value &&
      typeof value === "object" &&
      "discKey" in value &&
      "tracks" in value &&
      "source" in value &&
      "updatedAt" in value &&
      typeof (value as StoredAudioCdMetadata).discKey === "string" &&
      Array.isArray((value as StoredAudioCdMetadata).tracks) &&
      ((value as StoredAudioCdMetadata).source === "musicbrainz" || (value as StoredAudioCdMetadata).source === "manual") &&
      typeof (value as StoredAudioCdMetadata).updatedAt === "string"
  );
}
