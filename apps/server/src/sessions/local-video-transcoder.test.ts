import { describe, expect, it } from "vitest";
import { buildLocalVideoHlsArgs, isReadyHlsPlaylist } from "./local-video-transcoder.js";

describe("buildLocalVideoHlsArgs", () => {
  it("normalizes legacy video into browser-compatible HLS", () => {
    const args = buildLocalVideoHlsArgs({
      inputPath: "/media/movie.MPG",
      playlistPath: "/tmp/session/master.m3u8",
      segmentPattern: "/tmp/session/segment-%05d.ts",
      startSeconds: 42
    });

    expect(args).toContain("+genpts");
    expect(args).toContain("-ss");
    expect(args).toContain("42.000");
    expect(args).toContain("scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args).toContain("independent_segments+temp_file");
    expect(args).toContain("event");
  });

  it("can use macOS VideoToolbox for H.264 output", () => {
    const args = buildLocalVideoHlsArgs({
      inputPath: "/media/movie.MPG",
      playlistPath: "/tmp/session/master.m3u8",
      segmentPattern: "/tmp/session/segment-%05d.ts",
      videoEncoder: "h264_videotoolbox"
    });

    expect(args).toContain("h264_videotoolbox");
    expect(args).toContain("-b:v");
    expect(args).not.toContain("-crf");
  });

  it("waits for a playlist with playable segments", () => {
    expect(isReadyHlsPlaylist("#EXTM3U\n#EXT-X-VERSION:3\n")).toBe(false);
    expect(isReadyHlsPlaylist("#EXTM3U\n#EXTINF:4.000,\n")).toBe(false);
    expect(isReadyHlsPlaylist("#EXTM3U\n#EXTINF:4.000,\nsegment-00000.ts\n")).toBe(true);
  });
});
