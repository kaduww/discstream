import type { CommandCapabilities } from "@discstream/contracts";
import { runCommand } from "./process.js";

const commandNames: Array<keyof CommandCapabilities> = [
  "ffmpeg",
  "ffprobe",
  "cdparanoia",
  "cdInfo",
  "discid",
  "dvdbackup",
  "lsdvd",
  "eject",
  "lsblk",
  "udevadm",
  "udisksctl",
  "diskutil",
  "drutil",
  "ioreg"
];

const executableNames: Record<keyof CommandCapabilities, string> = {
  ffmpeg: "ffmpeg",
  ffprobe: "ffprobe",
  cdparanoia: "cdparanoia",
  cdInfo: "cd-info",
  discid: "discid",
  dvdbackup: "dvdbackup",
  lsdvd: "lsdvd",
  eject: "eject",
  lsblk: "lsblk",
  udevadm: "udevadm",
  udisksctl: "udisksctl",
  diskutil: "diskutil",
  drutil: "drutil",
  ioreg: "ioreg"
};

export async function detectCommands(): Promise<CommandCapabilities> {
  const entries = await Promise.all(
    commandNames.map(async (name) => {
      const executable = executableNames[name];
      const result = await runCommand("which", [executable], { timeoutMs: 1200 });
      return [name, result.code === 0] as const;
    })
  );

  return Object.fromEntries(entries) as CommandCapabilities;
}
