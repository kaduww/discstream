import { describe, expect, it } from "vitest";
import { parseLsblkDiscInfo } from "./lsblk-disc.js";

describe("parseLsblkDiscInfo", () => {
  it("detects a mounted data disc", () => {
    const info = parseLsblkDiscInfo(
      JSON.stringify({
        blockdevices: [
          {
            name: "sr0",
            path: "/dev/sr0",
            type: "rom",
            fstype: "iso9660",
            label: "MOVIE_DISC",
            mountpoint: "/media/carlos/MOVIE_DISC"
          }
        ]
      }),
      "/dev/sr0"
    );

    expect(info).toEqual({
      devicePath: "/dev/sr0",
      mediaPresent: true,
      mountedVolume: {
        mountPath: "/media/carlos/MOVIE_DISC",
        label: "MOVIE_DISC",
        filesystem: "iso9660"
      },
      inferredDiscType: "data-disc"
    });
  });

  it("returns no media when the drive node has no disc data", () => {
    const info = parseLsblkDiscInfo(
      JSON.stringify({
        blockdevices: [
          {
            name: "sr0",
            path: "/dev/sr0",
            type: "rom",
            mountpoint: null
          }
        ]
      }),
      "/dev/sr0"
    );

    expect(info).toMatchObject({
      mediaPresent: false,
      inferredDiscType: "none"
    });
  });
});
