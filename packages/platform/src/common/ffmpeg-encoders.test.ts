import { describe, expect, it } from "vitest";
import { parseFfmpegEncoders } from "./ffmpeg-encoders.js";

describe("parseFfmpegEncoders", () => {
  it("detects the encoders DiscStream uses for planning", () => {
    const output = `
 V..... libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 V..... h264_videotoolbox    VideoToolbox H.264 Encoder
 A..... aac                  AAC (Advanced Audio Coding)
 A..... libmp3lame           libmp3lame MP3
 A..... flac                 FLAC
`;

    expect(parseFfmpegEncoders(output)).toEqual({
      videoEncoders: {
        libx264: true,
        h264VideoToolbox: true,
        h264V4l2m2m: false
      },
      audioEncoders: {
        aac: true,
        libmp3lame: true,
        flac: true
      }
    });
  });
});
