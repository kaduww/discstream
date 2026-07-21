import { describe, expect, it } from "vitest";
import { isMacosAudioCdFilesystem, parseMacosMountOutput } from "./mount-output.js";

describe("parseMacosMountOutput", () => {
  it("extracts mounted Audio CD volumes", () => {
    const volumes = parseMacosMountOutput(
      "/dev/disk4 on /Volumes/Chronicle, Vol. 1 (cddafs, local, nodev, nosuid, read-only, noowners)"
    );

    expect(volumes).toEqual([
      {
        device: "/dev/disk4",
        mountPath: "/Volumes/Chronicle, Vol. 1",
        label: "Chronicle, Vol. 1",
        filesystem: "cddafs"
      }
    ]);
    expect(isMacosAudioCdFilesystem(volumes[0]?.filesystem)).toBe(true);
  });
});
