import type { MountedVolume } from "@discstream/contracts";

export interface MacosMountedVolume extends MountedVolume {
  device: string;
}

export function parseMacosMountOutput(output: string): MacosMountedVolume[] {
  const volumes: MacosMountedVolume[] = [];

  for (const line of output.split(/\r?\n/)) {
    const match = /^(\/dev\/\S+)\s+on\s+(.+)\s+\(([^,)]+)/.exec(line.trim());
    if (!match) {
      continue;
    }

    volumes.push({
      device: match[1]!,
      mountPath: match[2]!,
      label: volumeLabelFromPath(match[2]!),
      filesystem: match[3]!
    });
  }

  return volumes;
}

export function isMacosOpticalFilesystem(filesystem: string | undefined): boolean {
  return Boolean(filesystem && /cddafs|cd9660|udf/i.test(filesystem));
}

export function isMacosAudioCdFilesystem(filesystem: string | undefined): boolean {
  return Boolean(filesystem && /cddafs|cdda|audio/i.test(filesystem));
}

function volumeLabelFromPath(mountPath: string): string | undefined {
  const match = /^\/Volumes\/(.+)$/.exec(mountPath);
  return match?.[1];
}
