import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DiscInspection } from "@discstream/contracts";

export interface DvdChapterMetadataInput {
  number: number;
  title?: string | null;
}

export interface DvdTitleMetadataInput {
  id: number;
  chapters: DvdChapterMetadataInput[];
}

export interface DvdMetadataInput {
  titles: DvdTitleMetadataInput[];
}

export interface StoredDvdChapterMetadata {
  number: number;
  title: string;
}

export interface StoredDvdTitleMetadata {
  id: number;
  chapters: StoredDvdChapterMetadata[];
}

export interface StoredDvdMetadata {
  discKey: string;
  label?: string;
  titles: StoredDvdTitleMetadata[];
  updatedAt: string;
}

interface StoredDvdMetadataFile {
  discs: Record<string, StoredDvdMetadata>;
}

export class DvdMetadataStore {
  constructor(private readonly filePath: string) {}

  async getForDisc(disc: DiscInspection): Promise<StoredDvdMetadata | null> {
    const discKey = dvdDiscKey(disc);
    if (!discKey) {
      return null;
    }

    const stored = await this.readStoredMetadata();
    return stored.discs[discKey] ?? null;
  }

  async applyToDisc(disc: DiscInspection): Promise<DiscInspection> {
    const metadata = await this.getForDisc(disc);
    if (!metadata || disc.type !== "dvd-video" || !disc.dvdVideo) {
      return disc;
    }

    const titleMetadata = new Map(metadata.titles.map((title) => [title.id, title]));
    let changed = false;
    const titles = disc.dvdVideo.titles.map((title) => {
      const storedTitle = titleMetadata.get(title.id);
      if (!storedTitle || !title.chapters?.length) {
        return title;
      }

      const chapterMetadata = new Map(storedTitle.chapters.map((chapter) => [chapter.number, chapter.title]));
      const chapters = title.chapters.map((chapter) => {
        const storedChapterTitle = chapterMetadata.get(chapter.number);
        if (!storedChapterTitle || chapter.title === storedChapterTitle) {
          return chapter;
        }

        changed = true;
        return {
          ...chapter,
          title: storedChapterTitle
        };
      });

      return {
        ...title,
        chapters
      };
    });

    if (!changed) {
      return disc;
    }

    return {
      ...disc,
      dvdVideo: {
        ...disc.dvdVideo,
        titles,
        metadataSource: "manual"
      }
    };
  }

  async saveForDisc(disc: DiscInspection, input: DvdMetadataInput): Promise<StoredDvdMetadata> {
    const discKey = dvdDiscKey(disc);
    if (!discKey) {
      throw new Error("DVD metadata requires a DVD-Video disc.");
    }

    const stored = await this.readStoredMetadata();
    const existing = stored.discs[discKey];
    const titleMap = new Map((existing?.titles ?? []).map((title) => [title.id, title.chapters]));

    for (const title of input.titles) {
      const chapterMap = new Map((titleMap.get(title.id) ?? []).map((chapter) => [chapter.number, chapter.title]));
      for (const chapter of title.chapters) {
        const titleText = chapter.title?.trim();
        if (titleText) {
          chapterMap.set(chapter.number, titleText);
        } else {
          chapterMap.delete(chapter.number);
        }
      }

      if (chapterMap.size) {
        titleMap.set(
          title.id,
          [...chapterMap.entries()]
            .map(([number, titleText]) => ({
              number,
              title: titleText
            }))
            .sort((left, right) => left.number - right.number)
        );
      } else {
        titleMap.delete(title.id);
      }
    }

    const metadata: StoredDvdMetadata = {
      discKey,
      label: disc.label ?? disc.dvdVideo?.label ?? disc.mountedVolume?.label,
      titles: [...titleMap.entries()]
        .map(([id, chapters]) => ({
          id,
          chapters
        }))
        .sort((left, right) => left.id - right.id),
      updatedAt: new Date().toISOString()
    };

    if (metadata.titles.length) {
      stored.discs[discKey] = metadata;
    } else {
      delete stored.discs[discKey];
    }

    await this.writeStoredMetadata(stored);
    return metadata;
  }

  private async readStoredMetadata(): Promise<StoredDvdMetadataFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredDvdMetadataFile>;
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

  private async writeStoredMetadata(stored: StoredDvdMetadataFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  }
}

export function dvdDiscKey(disc: DiscInspection): string | null {
  if (disc.type !== "dvd-video" || !disc.dvdVideo) {
    return null;
  }

  const fingerprint = JSON.stringify({
    label: disc.label ?? disc.dvdVideo.label ?? disc.mountedVolume?.label,
    titles: disc.dvdVideo.titles.map((title) => ({
      id: title.id,
      durationSeconds: title.durationSeconds ? Math.round(title.durationSeconds) : undefined,
      chapters: title.chapters?.length ?? 0,
      audioTracks: title.audioTracks?.length ?? 0,
      subtitleTracks: title.subtitleTracks?.length ?? 0,
      aspectRatio: title.aspectRatio
    }))
  });
  const digest = crypto.createHash("sha1").update(fingerprint).digest("hex").slice(0, 16);
  return `dvd-${digest}`;
}

function filterStoredDiscs(discs: Record<string, unknown>): Record<string, StoredDvdMetadata> {
  return Object.fromEntries(
    Object.entries(discs).filter((entry): entry is [string, StoredDvdMetadata] => isStoredDvdMetadata(entry[1]))
  );
}

function isStoredDvdMetadata(value: unknown): value is StoredDvdMetadata {
  return Boolean(
    value &&
      typeof value === "object" &&
      "discKey" in value &&
      "titles" in value &&
      "updatedAt" in value &&
      typeof (value as StoredDvdMetadata).discKey === "string" &&
      Array.isArray((value as StoredDvdMetadata).titles) &&
      typeof (value as StoredDvdMetadata).updatedAt === "string"
  );
}
