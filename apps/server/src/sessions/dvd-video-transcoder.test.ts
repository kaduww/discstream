import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDvdConcatFile,
  buildDvdConcatProtocolInput,
  buildDvdHlsArgs,
  buildDvdSourceList,
  findDvdTitleSets,
  resolveVideoTsPath,
  selectDvdTitleSet
} from "./dvd-video-transcoder.js";

describe("DVD video transcoder helpers", () => {
  it("finds VOB title sets and selects the largest one", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "discstream-dvd-"));
    const videoTsPath = path.join(rootPath, "VIDEO_TS");
    await mkdir(videoTsPath);
    await writeFile(path.join(videoTsPath, "VTS_01_1.VOB"), Buffer.alloc(10));
    await writeFile(path.join(videoTsPath, "VTS_01_2.VOB"), Buffer.alloc(10));
    await writeFile(path.join(videoTsPath, "VTS_02_1.VOB"), Buffer.alloc(30));
    await writeFile(path.join(videoTsPath, "VTS_02_0.VOB"), Buffer.alloc(100));
    await writeFile(path.join(videoTsPath, "VIDEO_TS.VOB"), Buffer.alloc(100));

    await expect(resolveVideoTsPath(rootPath)).resolves.toBe(videoTsPath);
    const titleSets = await findDvdTitleSets(videoTsPath);

    expect(titleSets).toEqual([
      {
        title: 1,
        files: [path.join(videoTsPath, "VTS_01_1.VOB"), path.join(videoTsPath, "VTS_01_2.VOB")],
        sizeBytes: 20
      },
      {
        title: 2,
        files: [path.join(videoTsPath, "VTS_02_1.VOB")],
        sizeBytes: 30
      }
    ]);
    expect(selectDvdTitleSet(titleSets)?.title).toBe(2);
    expect(selectDvdTitleSet(titleSets, 1)?.title).toBe(1);
  });

  it("builds a concat manifest and HLS arguments for browser playback", () => {
    expect(buildDvdConcatFile(["/DVD/VIDEO_TS/VTS_01_1.VOB", "/DVD/VIDEO_TS/VTS_01_2.VOB"])).toBe(
      "ffconcat version 1.0\nfile '/DVD/VIDEO_TS/VTS_01_1.VOB'\nfile '/DVD/VIDEO_TS/VTS_01_2.VOB'\n"
    );
    expect(buildDvdSourceList(["/DVD/VIDEO_TS/VTS_01_1.VOB", "/DVD/VIDEO_TS/VTS_01_2.VOB"])).toBe(
      "/DVD/VIDEO_TS/VTS_01_1.VOB\n/DVD/VIDEO_TS/VTS_01_2.VOB\n"
    );

    const args = buildDvdHlsArgs({
      concatPath: "/tmp/session/title.ffconcat",
      playlistPath: "/tmp/session/master.m3u8",
      segmentPattern: "/tmp/session/segment-%05d.ts"
    });

    expect(args).toContain("concat");
    expect(args).toContain("/tmp/session/title.ffconcat");
    expect(args).toContain("100M");
    expect(args).toContain("yadif=0:-1:0,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args).toContain("independent_segments");
    expect(args).toContain("event");
  });

  it("builds HLS arguments with selected DVD audio", () => {
    const args = buildDvdHlsArgs({
      concatPath: "/tmp/session/title.ffconcat",
      playlistPath: "/tmp/session/master.m3u8",
      segmentPattern: "/tmp/session/segment-%05d.ts",
      audioTrack: 3
    });

    expect(args).toContain("-vf");
    expect(args).toContain("0:v:0");
    expect(args).toContain("0:3");
    expect(args).toContain("aac");
  });

  it("builds HLS arguments with a DVD chapter start time", () => {
    const args = buildDvdHlsArgs({
      concatPath: "/tmp/session/title.ffconcat",
      playlistPath: "/tmp/session/master.m3u8",
      segmentPattern: "/tmp/session/segment-%05d.ts",
      startSeconds: 83.5
    });

    expect(args).toContain("-ss");
    expect(args).toContain("83.5");
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
  });

  it("builds HLS arguments with burned-in DVD subtitles", () => {
    expect(buildDvdConcatProtocolInput(["/DVD/VIDEO_TS/VTS_01_1.VOB", "/DVD/VIDEO_TS/VTS_01_2.VOB"])).toBe(
      "concat:/DVD/VIDEO_TS/VTS_01_1.VOB|/DVD/VIDEO_TS/VTS_01_2.VOB"
    );

    const args = buildDvdHlsArgs({
      concatPath: "/tmp/session/title.ffconcat",
      concatProtocolInput: "concat:/DVD/VIDEO_TS/VTS_01_1.VOB|/DVD/VIDEO_TS/VTS_01_2.VOB",
      playlistPath: "/tmp/session/master.m3u8",
      segmentPattern: "/tmp/session/segment-%05d.ts",
      audioTrack: 3,
      subtitleTrack: 4
    });

    expect(args).toContain("concat:/DVD/VIDEO_TS/VTS_01_1.VOB|/DVD/VIDEO_TS/VTS_01_2.VOB");
    expect(args).toContain("-filter_complex");
    expect(args).toContain("[0:v:0][0:4]overlay,yadif=0:-1:0,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[v]");
    expect(args).toContain("[v]");
    expect(args).toContain("0:3");
    expect(args).toContain("-sn");
  });

  it("builds DVD HLS arguments with a hardware H.264 encoder", () => {
    const args = buildDvdHlsArgs({
      concatPath: "/tmp/session/title.ffconcat",
      playlistPath: "/tmp/session/master.m3u8",
      segmentPattern: "/tmp/session/segment-%05d.ts",
      videoEncoder: "h264_v4l2m2m"
    });

    expect(args).toContain("h264_v4l2m2m");
    expect(args).toContain("-b:v");
    expect(args).not.toContain("-crf");
  });
});
