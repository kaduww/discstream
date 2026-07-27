import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFinalMuxArgs,
  buildFrameExtractionArgs,
  buildRestoredSegmentArgs,
  buildSegmentJoinArgs,
  restorationVideoEncoderArgs
} from "./ai-restoration-manager.js";

describe("AI restoration pipeline arguments", () => {
  it("extracts deinterlaced square-pixel frames at a stable frame rate", () => {
    const args = buildFrameExtractionArgs("/cache/source.ffconcat", "/cache/input/frame-%08d.jpg");

    expect(args).toContain("concat");
    expect(args).toContain(
      "yadif=0:-1:0,fps=30000/1001,scale=trunc(iw*sar/2)*2:trunc(ih/2)*2:flags=lanczos,setsar=1"
    );
    expect(args).toContain("2");
    expect(args.at(-1)).toBe("/cache/input/frame-%08d.jpg");
  });

  it("remuxes restored frames with DVD audio into a browser-compatible MP4", () => {
    const args = buildRestoredSegmentArgs("/cache/restored", "/cache/segment.mp4");

    expect(args).toContain(path.join("/cache/restored", "frame-%08d.jpg"));
    expect(args).toContain("libx264");
    expect(args).toContain("-an");
    expect(args.at(-1)).toBe("/cache/segment.mp4");

    expect(buildSegmentJoinArgs("/cache/segments.ffconcat", "/cache/video.mp4")).toContain("copy");
    const muxArgs = buildFinalMuxArgs("/cache/video.mp4", "/cache/source.ffconcat", "/cache/restored.tmp.mp4");
    expect(muxArgs).toContain("aac");
    expect(muxArgs).toContain("+faststart");
    expect(muxArgs).toContain("-map_chapters");
  });

  it("uses NVIDIA NVENC for restored segments when available", () => {
    expect(restorationVideoEncoderArgs("h264_nvenc")).toEqual([
      "-c:v", "h264_nvenc",
      "-preset", "p6",
      "-tune", "hq",
      "-rc", "vbr",
      "-cq", "19",
      "-b:v", "0"
    ]);
  });
});
