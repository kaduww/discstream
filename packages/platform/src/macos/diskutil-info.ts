import type { MountedVolume } from "@discstream/contracts";

export function parseDiskutilInfo(output: string): MountedVolume | undefined {
  const mountPath = matchLineValue(output, "Mount Point");
  if (!mountPath || /not mounted/i.test(mountPath)) {
    return undefined;
  }

  return {
    mountPath,
    label: matchLineValue(output, "Volume Name"),
    filesystem: matchLineValue(output, "File System Personality")
  };
}

function matchLineValue(text: string, label: string): string | undefined {
  const match = new RegExp(`^\\s*${label}:\\s*(.+?)\\s*$`, "im").exec(text);
  return match?.[1]?.trim();
}
