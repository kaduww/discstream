import { describe, expect, it } from "vitest";
import {
  buildCdparanoiaArgs,
  buildFfmpegAudioFileToMp3Args,
  buildFfmpegAudioFileToMp3FileArgs,
  buildFfmpegAudioFileToHlsArgs,
  buildFfmpegPipedAudioFileToMp3Args,
  buildFfmpegPipedAudioFileToHlsArgs,
  buildFfmpegWavToMp3Args,
  getHlsPlaylistBufferedSeconds
} from "./audio-cd-streamer.js";

describe("audio CD stream command builders", () => {
  it("builds a cdparanoia track extraction command", () => {
    expect(buildCdparanoiaArgs({ devicePath: "/dev/sr0", track: 2 })).toEqual(["-d", "/dev/sr0", "-w", "2", "-"]);
  });

  it("builds ffmpeg wav-to-mp3 arguments for browser playback", () => {
    expect(buildFfmpegWavToMp3Args()).toEqual([
      "-hide_banner",
      "-loglevel",
      "warning",
      "-f",
      "wav",
      "-i",
      "pipe:0",
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-f",
      "mp3",
      "pipe:1"
    ]);
  });

  it("builds ffmpeg mounted-track arguments", () => {
    expect(buildFfmpegAudioFileToMp3Args("/Volumes/Audio CD/01.aiff")).toContain("/Volumes/Audio CD/01.aiff");
  });

  it("builds ffmpeg piped mounted-track arguments for faster browser playback", () => {
    expect(buildFfmpegPipedAudioFileToMp3Args("aiff")).toEqual([
      "-hide_banner",
      "-loglevel",
      "warning",
      "-f",
      "aiff",
      "-i",
      "pipe:0",
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-f",
      "mp3",
      "pipe:1"
    ]);
  });

  it("builds ffmpeg mounted-track cache arguments", () => {
    expect(buildFfmpegAudioFileToMp3FileArgs("/Volumes/Audio CD/01.aiff", "/tmp/track.mp3")).toEqual([
      "-hide_banner",
      "-loglevel",
      "warning",
      "-y",
      "-i",
      "/Volumes/Audio CD/01.aiff",
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-f",
      "mp3",
      "/tmp/track.mp3"
    ]);
  });

  it("builds ffmpeg mounted-track HLS arguments", () => {
    expect(
      buildFfmpegAudioFileToHlsArgs({
        filePath: "/Volumes/Audio CD/01.aiff",
        playlistPath: "/tmp/master.m3u8",
        segmentPattern: "/tmp/segment-%05d.ts"
      })
    ).toEqual([
      "-hide_banner",
      "-y",
      "-i",
      "/Volumes/Audio CD/01.aiff",
      "-vn",
      "-codec:a",
      "aac",
      "-b:a",
      "160k",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-f",
      "hls",
      "-hls_time",
      "2",
      "-hls_list_size",
      "0",
      "-hls_playlist_type",
      "event",
      "-hls_segment_type",
      "mpegts",
      "-hls_segment_filename",
      "/tmp/segment-%05d.ts",
      "/tmp/master.m3u8"
    ]);
  });

  it("builds ffmpeg piped mounted-track HLS arguments", () => {
    expect(
      buildFfmpegPipedAudioFileToHlsArgs({
        inputFormat: "aiff",
        playlistPath: "/tmp/master.m3u8",
        segmentPattern: "/tmp/segment-%05d.ts"
      })
    ).toEqual([
      "-hide_banner",
      "-y",
      "-f",
      "aiff",
      "-i",
      "pipe:0",
      "-vn",
      "-codec:a",
      "aac",
      "-b:a",
      "160k",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-f",
      "hls",
      "-hls_time",
      "2",
      "-hls_list_size",
      "0",
      "-hls_playlist_type",
      "event",
      "-hls_segment_type",
      "mpegts",
      "-hls_segment_filename",
      "/tmp/segment-%05d.ts",
      "/tmp/master.m3u8"
    ]);
  });

  it("counts buffered seconds from an HLS playlist", () => {
    expect(
      getHlsPlaylistBufferedSeconds(`#EXTM3U
#EXTINF:2.020133,
segment-00000.ts
#EXTINF:1.996922,
segment-00001.ts
#EXT-X-ENDLIST`)
    ).toBeCloseTo(4.017055);
  });
});
