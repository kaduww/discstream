import { describe, expect, it } from "vitest";
import { parseDrutilStatus } from "./drutil-status.js";

describe("parseDrutilStatus", () => {
  it("detects an inserted DVD", () => {
    const result = parseDrutilStatus(`
 Vendor   Product           Rev
 HL-DT-ST DVDRW GX50N       RP09

           Type: DVD-ROM              Name: /dev/disk5
       Sessions: 1                  Tracks: 1
    `);

    expect(result).toMatchObject({
      hasDrive: true,
      mediaPresent: true,
      device: "/dev/disk5",
      typeText: "DVD-ROM",
      inferredDiscType: "dvd-video"
    });
  });

  it("detects an empty drive", () => {
    const result = parseDrutilStatus(`
 Vendor   Product           Rev
 HL-DT-ST DVDRW GX50N       RP09

           Type: No Media Inserted
    `);

    expect(result).toMatchObject({
      hasDrive: true,
      mediaPresent: false,
      inferredDiscType: "none"
    });
  });

  it("detects no drive", () => {
    expect(parseDrutilStatus("No drives found")).toMatchObject({
      hasDrive: false,
      mediaPresent: false,
      inferredDiscType: "none"
    });
  });
});
