import { describe, expect, it } from "vitest";
import { parseDiskutilInfo } from "./diskutil-info.js";

describe("parseDiskutilInfo", () => {
  it("extracts mounted volume details", () => {
    const volume = parseDiskutilInfo(`
   Volume Name:              MOVIE_DISC
   Mounted:                  Yes
   Mount Point:              /Volumes/MOVIE_DISC
   File System Personality:  ISO 9660
    `);

    expect(volume).toEqual({
      mountPath: "/Volumes/MOVIE_DISC",
      label: "MOVIE_DISC",
      filesystem: "ISO 9660"
    });
  });

  it("ignores unmounted volumes", () => {
    expect(parseDiskutilInfo("Mount Point: Not Mounted")).toBeUndefined();
  });
});
