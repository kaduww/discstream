import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DiscInspection } from "@discstream/contracts";
import { DvdMetadataStore, dvdDiscKey } from "./dvd-metadata-store.js";

describe("DvdMetadataStore", () => {
  it("saves and applies chapter titles for a DVD", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "discstream-dvd-metadata-"));
    const storeFile = path.join(tempDir, "dvd-metadata.json");
    const store = new DvdMetadataStore(storeFile);
    const disc = dvdDisc();

    const saved = await store.saveForDisc(disc, {
      titles: [
        {
          id: 1,
          chapters: [
            {
              number: 1,
              title: "Aces High"
            },
            {
              number: 2,
              title: "The Trooper"
            }
          ]
        }
      ]
    });

    expect(saved.discKey).toBe(dvdDiscKey(disc));
    const applied = await store.applyToDisc(disc);

    expect(applied.dvdVideo?.metadataSource).toBe("manual");
    expect(applied.dvdVideo?.titles[0]?.chapters).toMatchObject([
      {
        number: 1,
        title: "Aces High"
      },
      {
        number: 2,
        title: "The Trooper"
      }
    ]);

    const persisted = JSON.parse(await readFile(storeFile, "utf8")) as { discs: Record<string, unknown> };
    expect(Object.keys(persisted.discs)).toEqual([saved.discKey]);
  });

  it("clears a stored chapter title when an empty value is saved", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "discstream-dvd-metadata-"));
    const store = new DvdMetadataStore(path.join(tempDir, "dvd-metadata.json"));
    const disc = dvdDisc();

    await store.saveForDisc(disc, {
      titles: [
        {
          id: 1,
          chapters: [
            {
              number: 1,
              title: "Aces High"
            }
          ]
        }
      ]
    });
    await store.saveForDisc(disc, {
      titles: [
        {
          id: 1,
          chapters: [
            {
              number: 1,
              title: ""
            }
          ]
        }
      ]
    });

    await expect(store.getForDisc(disc)).resolves.toBeNull();
    await expect(store.applyToDisc(disc)).resolves.toEqual(disc);
  });
});

function dvdDisc(): DiscInspection {
  return {
    driveId: "drive-0",
    type: "dvd-video",
    label: "IRON_MAIDEN_D1",
    mountedVolume: {
      mountPath: "/Volumes/IRON_MAIDEN_D1",
      label: "IRON_MAIDEN_D1",
      filesystem: "udf"
    },
    dvdVideo: {
      label: "IRON_MAIDEN_D1",
      mainTitleId: 1,
      metadataSource: "none",
      titles: [
        {
          id: 1,
          durationSeconds: 7647,
          chapters: [
            {
              number: 1,
              startSeconds: 0,
              durationSeconds: 245
            },
            {
              number: 2,
              startSeconds: 245,
              durationSeconds: 279
            }
          ]
        }
      ]
    },
    warnings: [],
    inspectedAt: "2026-07-21T15:30:54.448Z"
  };
}
