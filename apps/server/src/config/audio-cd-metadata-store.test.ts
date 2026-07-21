import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DiscInspection } from "@discstream/contracts";
import { AudioCdMetadataStore, audioCdDiscKey, audioCdTocFromDisc } from "./audio-cd-metadata-store.js";

describe("AudioCdMetadataStore", () => {
  it("builds a fuzzy MusicBrainz TOC from mounted track durations", () => {
    expect(audioCdTocFromDisc(audioCdDisc())).toBe("1 2 525 150 300");
  });

  it("saves and applies cached Audio CD metadata", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "discstream-audio-cd-metadata-"));
    const storeFile = path.join(tempDir, "audio-cd-metadata.json");
    const store = new AudioCdMetadataStore(storeFile);
    const disc = audioCdDisc();

    const saved = await store.saveForDisc(disc, {
      albumTitle: "Live After Death",
      albumArtist: "Iron Maiden",
      musicBrainzReleaseId: "release-1",
      tracks: [
        {
          number: 1,
          title: "Intro",
          artist: "Iron Maiden"
        },
        {
          number: 2,
          title: "Aces High",
          artist: "Iron Maiden"
        }
      ],
      source: "musicbrainz"
    });

    expect(saved.discKey).toBe(audioCdDiscKey(disc));
    const applied = await store.applyToDisc(disc);

    expect(applied.audioCd?.metadataSource).toBe("cache");
    expect(applied.audioCd?.albumTitle).toBe("Live After Death");
    expect(applied.audioCd?.albumArtist).toBe("Iron Maiden");
    expect(applied.audioCd?.tracks).toMatchObject([
      {
        number: 1,
        title: "Intro",
        artist: "Iron Maiden"
      },
      {
        number: 2,
        title: "Aces High",
        artist: "Iron Maiden"
      }
    ]);

    const persisted = JSON.parse(await readFile(storeFile, "utf8")) as { discs: Record<string, unknown> };
    expect(Object.keys(persisted.discs)).toEqual([saved.discKey]);
  });
});

function audioCdDisc(): DiscInspection {
  return {
    driveId: "drive-0",
    type: "audio-cd",
    label: "Audio CD",
    mountedVolume: {
      mountPath: "/Volumes/Audio CD",
      label: "Audio CD",
      filesystem: "cddafs"
    },
    audioCd: {
      durationSeconds: 5,
      tracks: [
        {
          number: 1,
          durationSeconds: 2
        },
        {
          number: 2,
          durationSeconds: 3
        }
      ],
      metadataSource: "none"
    },
    warnings: [],
    inspectedAt: "2026-07-21T15:30:54.448Z"
  };
}
