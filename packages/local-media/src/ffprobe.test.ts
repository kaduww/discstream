import { describe, expect, it } from "vitest";
import { parseFfprobeJson } from "./ffprobe.js";

describe("parseFfprobeJson", () => {
  it("extracts duration, bitrate, tags, video stream, and audio stream", () => {
    const probe = parseFfprobeJson({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          duration: "61.500000",
          bit_rate: "4000000"
        },
        {
          codec_type: "audio",
          codec_name: "aac",
          bit_rate: "128000",
          tags: {
            title: "Song title"
          }
        }
      ],
      format: {
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
        duration: "62.000000",
        bit_rate: "4200000",
        tags: {
          artist: "Artist",
          album: "Album",
          track: "2/10"
        }
      }
    });

    expect(probe).toMatchObject({
      formatName: "mov,mp4,m4a,3gp,3g2,mj2",
      durationSeconds: 62,
      bitrateKbps: 4200,
      title: "Song title",
      artist: "Artist",
      albumTitle: "Album",
      trackNumber: 2,
      videoStream: {
        codec: "h264",
        width: 1920,
        height: 1080,
        bitrateKbps: 4000
      },
      audioStream: {
        codec: "aac",
        bitrateKbps: 128
      }
    });
  });
});
