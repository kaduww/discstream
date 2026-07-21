import { describe, expect, it } from "vitest";
import { audioMetadataFor, classifyLocalPath, videoMetadataFor } from "./metadata-probe.js";

describe("classifyLocalPath", () => {
  it("classifies common local audio and video formats", () => {
    expect(classifyLocalPath("song.mp3", false)).toBe("audio-file");
    expect(classifyLocalPath("movie.mkv", false)).toBe("video-file");
    expect(classifyLocalPath("/DVD/VIDEO_TS", true)).toBe("dvd-video-folder");
  });

  it("marks non-direct-play video as requiring transcoding", () => {
    expect(videoMetadataFor("movie.mkv")).toMatchObject({
      container: "mkv",
      directPlaySupported: false,
      transcodeRequired: true
    });
  });

  it("uses ffprobe video codecs to decide direct playback", () => {
    expect(
      videoMetadataFor("movie.mp4", {
        videoStream: { codec: "mpeg2video", width: 720, height: 480 },
        audioStream: { codec: "mp2" },
        durationSeconds: 25
      })
    ).toMatchObject({
      container: "mp4",
      videoCodec: "mpeg2video",
      audioCodec: "mp2",
      width: 720,
      height: 480,
      durationSeconds: 25,
      directPlaySupported: false,
      transcodeRequired: true
    });
  });

  it("uses ffprobe audio tags for display metadata", () => {
    expect(
      audioMetadataFor("track.mp3", {
        title: "Real title",
        artist: "Real artist",
        audioStream: { codec: "mp3", bitrateKbps: 192 },
        durationSeconds: 185
      })
    ).toMatchObject({
      format: "mp3",
      codec: "mp3",
      title: "Real title",
      artist: "Real artist",
      durationSeconds: 185,
      bitrateKbps: 192
    });
  });
});
