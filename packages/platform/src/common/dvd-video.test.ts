import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectDvdVideoFolder, parseDvdIfoAttributes, parseDvdTitleProbe } from "./dvd-video.js";

describe("inspectDvdVideoFolder", () => {
  it("lists DVD titles and marks the largest title as the main title", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "discstream-dvd-inspect-"));
    const videoTsPath = path.join(rootPath, "VIDEO_TS");
    await mkdir(videoTsPath);
    await writeFile(path.join(videoTsPath, "VTS_01_1.VOB"), Buffer.alloc(8));
    await writeFile(path.join(videoTsPath, "VTS_02_1.VOB"), Buffer.alloc(12));
    await writeFile(path.join(videoTsPath, "VTS_02_2.VOB"), Buffer.alloc(12));
    await writeFile(path.join(videoTsPath, "VTS_03_0.VOB"), Buffer.alloc(80));

    await expect(inspectDvdVideoFolder(rootPath, "Movie Disc")).resolves.toEqual({
      label: "Movie Disc",
      mainTitleId: 2,
      titles: [{ id: 1 }, { id: 2 }],
      metadataSource: "none"
    });
  });

  it("maps ffprobe title details into the DVD model", () => {
    expect(
      parseDvdTitleProbe(
        {
          title: 4,
          files: ["/DVD/VIDEO_TS/VTS_04_1.VOB", "/DVD/VIDEO_TS/VTS_04_2.VOB"],
          sizeBytes: 2000
        },
        {
          format: {
            duration: "10.2"
          },
          streams: [
            {
              index: 0,
              codec_type: "video",
              codec_name: "mpeg2video",
              width: 720,
              height: 480,
              display_aspect_ratio: "16:9"
            },
            {
              index: 1,
              codec_type: "audio",
              codec_name: "ac3",
              channel_layout: "5.1(side)",
              tags: {
                language: "eng"
              }
            },
            {
              index: 2,
              codec_type: "subtitle",
              codec_name: "dvd_subtitle",
              tags: {
                language: "por"
              }
            }
          ],
          chapters: [
            {
              start_time: "0.000000",
              end_time: "4.000000"
            },
            {
              start_time: "4.000000",
              end_time: "10.200000"
            }
          ]
        },
        1000
      )
    ).toEqual({
      id: 4,
      durationSeconds: 20,
      chapters: [
        {
          number: 1,
          startSeconds: 0,
          durationSeconds: 4
        },
        {
          number: 2,
          startSeconds: 4,
          durationSeconds: 6
        }
      ],
      audioTracks: [
        {
          id: 1,
          language: "eng",
          codec: "ac3",
          channels: "5.1(side)"
        }
      ],
      subtitleTracks: [
        {
          id: 2,
          language: "por",
          format: "dvd_subtitle"
        }
      ],
      aspectRatio: "16:9"
    });
  });

  it("fills DVD audio and subtitle languages from VTS IFO attributes", () => {
    const ifo = Buffer.alloc(0x316);
    ifo.write("DVDVIDEO-VTS", 0, "latin1");
    ifo.writeUInt16BE(2, 0x202);
    Buffer.from("04c5656e00000000", "hex").copy(ifo, 0x204);
    Buffer.from("c4c5656e00000000", "hex").copy(ifo, 0x204 + 8);
    ifo.writeUInt16BE(3, 0x254);
    Buffer.from("010070740000", "hex").copy(ifo, 0x256);
    Buffer.from("0100656e0000", "hex").copy(ifo, 0x256 + 6);
    Buffer.from("010065730000", "hex").copy(ifo, 0x256 + 12);

    const ifoAttributes = parseDvdIfoAttributes(ifo);

    expect(ifoAttributes).toEqual({
      audioLanguages: ["en", "en"],
      subtitleLanguages: ["pt", "en", "es"]
    });

    expect(
      parseDvdTitleProbe(
        {
          title: 1,
          files: ["/DVD/VIDEO_TS/VTS_01_1.VOB"],
          sizeBytes: 1000
        },
        {
          streams: [
            {
              index: 0,
              codec_type: "video",
              codec_name: "mpeg2video"
            },
            {
              index: 2,
              codec_type: "audio",
              codec_name: "ac3"
            },
            {
              index: 3,
              codec_type: "audio",
              codec_name: "dts"
            },
            {
              index: 4,
              codec_type: "subtitle",
              codec_name: "dvd_subtitle"
            },
            {
              index: 5,
              codec_type: "subtitle",
              codec_name: "dvd_subtitle"
            },
            {
              index: 6,
              codec_type: "subtitle",
              codec_name: "dvd_subtitle"
            }
          ]
        },
        undefined,
        ifoAttributes
      )
    ).toMatchObject({
      audioTracks: [
        {
          id: 2,
          language: "en"
        },
        {
          id: 3,
          language: "en"
        }
      ],
      subtitleTracks: [
        {
          id: 4,
          language: "pt"
        },
        {
          id: 5,
          language: "en"
        },
        {
          id: 6,
          language: "es"
        }
      ]
    });
  });

  it("fills DVD chapters from VTS IFO program chains", () => {
    const ifo = Buffer.alloc(8192);
    ifo.write("DVDVIDEO-VTS", 0, "latin1");
    ifo.writeUInt32BE(1, 0xc8);
    ifo.writeUInt32BE(2, 0xcc);

    const pttStart = 2048;
    ifo.writeUInt16BE(1, pttStart);
    ifo.writeUInt32BE(23, pttStart + 4);
    ifo.writeUInt32BE(12, pttStart + 8);
    for (let index = 0; index < 3; index++) {
      const offset = pttStart + 12 + index * 4;
      ifo.writeUInt16BE(1, offset);
      ifo.writeUInt16BE(index + 1, offset + 2);
    }

    const pgciStart = 4096;
    const pgcStart = pgciStart + 16;
    ifo.writeUInt16BE(1, pgciStart);
    ifo.writeUInt32BE(16 + 0xf0 + 3 * 24 - 1, pgciStart + 4);
    ifo.writeUInt32BE(0x81000000, pgciStart + 8);
    ifo.writeUInt32BE(16, pgciStart + 12);

    ifo.writeUInt8(3, pgcStart + 2);
    ifo.writeUInt8(3, pgcStart + 3);
    ifo.writeUInt16BE(0xec, pgcStart + 0xe6);
    ifo.writeUInt16BE(0xf0, pgcStart + 0xe8);
    Buffer.from([1, 2, 3]).copy(ifo, pgcStart + 0xec);
    Buffer.from([0x00, 0x01, 0x00, 0x40]).copy(ifo, pgcStart + 0xf0 + 4);
    Buffer.from([0x00, 0x02, 0x00, 0x40]).copy(ifo, pgcStart + 0xf0 + 24 + 4);
    Buffer.from([0x00, 0x00, 0x30, 0x40]).copy(ifo, pgcStart + 0xf0 + 48 + 4);

    const ifoAttributes = parseDvdIfoAttributes(ifo);

    expect(ifoAttributes?.chapters).toEqual([
      {
        number: 1,
        startSeconds: 0,
        durationSeconds: 60
      },
      {
        number: 2,
        startSeconds: 60,
        durationSeconds: 120
      },
      {
        number: 3,
        startSeconds: 180,
        durationSeconds: 30
      }
    ]);
  });
});
