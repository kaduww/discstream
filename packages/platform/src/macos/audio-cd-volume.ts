import fs from "node:fs/promises";
import path from "node:path";
import type { AudioCdTrack } from "@discstream/contracts";

const cdAudioBytesPerSecond = 44_100 * 2 * 2;

export async function readMountedAudioCdTracks(mountPath: string): Promise<AudioCdTrack[]> {
  let entries;
  try {
    entries = await fs.readdir(mountPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const tracks: AudioCdTrack[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || ![".aif", ".aiff", ".wav"].includes(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    const number = trackNumberFromName(entry.name);
    if (!number) {
      continue;
    }

    let durationSeconds: number | undefined;
    try {
      const stat = await fs.stat(path.join(mountPath, entry.name));
      durationSeconds = Math.max(0, Math.round(stat.size / cdAudioBytesPerSecond));
    } catch {
      durationSeconds = undefined;
    }

    tracks.push({
      number,
      title: trackTitleFromName(entry.name),
      durationSeconds
    });
  }

  return tracks.sort((left, right) => left.number - right.number);
}

function trackNumberFromName(fileName: string): number | undefined {
  const match = /^(\d+)/.exec(fileName);
  if (!match) {
    return undefined;
  }

  const number = Number.parseInt(match[1]!, 10);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function trackTitleFromName(fileName: string): string | undefined {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const title = withoutExtension.replace(/^\d+\s*/, "").trim();
  return title || undefined;
}
