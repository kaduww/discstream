import { execFile } from "node:child_process";
import type { DiscInspection } from "@discstream/contracts";
import { audioCdTocFromDisc, type AudioCdMetadataInput } from "./audio-cd-metadata-store.js";

export interface AudioCdMetadataLookupRequest {
  disc: DiscInspection;
  devicePath?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  baseUrl?: string;
  userAgent?: string;
}

export interface AudioCdMetadataLookupResult {
  metadata: AudioCdMetadataInput;
  candidates: AudioCdMetadataInput[];
  candidateCount: number;
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<FetchResponseLike>;

interface DiscIdCommandResult {
  discId?: string;
  toc?: string;
}

export async function lookupAudioCdMetadata(request: AudioCdMetadataLookupRequest): Promise<AudioCdMetadataLookupResult> {
  const commandDisc = await readDiscIdFromCommand(request.devicePath, request.timeoutMs);
  const discId = commandDisc.discId ?? request.disc.audioCd?.discId;
  const toc = commandDisc.toc ?? audioCdTocFromDisc(request.disc) ?? undefined;
  if (!discId && !toc) {
    throw new Error("Audio CD metadata lookup needs a Disc ID or track durations.");
  }

  const client = new MusicBrainzClient({
    fetch: request.fetch,
    timeoutMs: request.timeoutMs,
    baseUrl: request.baseUrl,
    userAgent: request.userAgent
  });
  const lookup = await client.lookupDisc({
    discId: discId ?? "-",
    toc,
    expectedTrackCount: request.disc.audioCd?.tracks.length ?? 0
  });

  return {
    metadata: {
      ...lookup.metadata,
      discId,
      toc,
      source: "musicbrainz"
    },
    candidates: lookup.candidates.map((candidate) => ({
      ...candidate,
      discId,
      toc,
      source: "musicbrainz"
    })),
    candidateCount: lookup.candidateCount
  };
}

export class MusicBrainzClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly userAgent: string;

  constructor(options: { fetch?: FetchLike; timeoutMs?: number; baseUrl?: string; userAgent?: string } = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.baseUrl = options.baseUrl ?? "https://musicbrainz.org";
    this.userAgent = options.userAgent ?? "DiscStream/0.1.0 (local DiscStream metadata lookup)";
  }

  async lookupDisc(request: { discId: string; toc?: string; expectedTrackCount: number }): Promise<AudioCdMetadataLookupResult> {
    const url = new URL(`/ws/2/discid/${encodeURIComponent(request.discId)}`, this.baseUrl);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("inc", "recordings+artist-credits+media");
    url.searchParams.set("cdstubs", "no");
    if (request.toc) {
      url.searchParams.set("toc", request.toc);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(url.toString(), {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent
        }
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`MusicBrainz lookup failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`);
      }

      return metadataFromMusicBrainzResponse(await response.json(), request.expectedTrackCount);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function metadataFromMusicBrainzResponse(payload: unknown, expectedTrackCount: number): AudioCdMetadataLookupResult {
  const candidates = metadataCandidatesFromMusicBrainzResponse(payload, expectedTrackCount);

  if (candidates.length === 0) {
    throw new Error("MusicBrainz did not return a matching Audio CD release.");
  }

  const best = selectBestAudioCdMetadataCandidate(candidates, expectedTrackCount);

  return {
    metadata: best,
    candidates,
    candidateCount: candidates.length
  };
}

export function metadataCandidatesFromMusicBrainzResponse(payload: unknown, expectedTrackCount: number): AudioCdMetadataInput[] {
  const releases = asArray(readRecord(payload)?.releases);
  return releases
    .map((release) => metadataFromRelease(readRecord(release), expectedTrackCount))
    .filter((metadata): metadata is AudioCdMetadataInput => Boolean(metadata));
}

export function selectBestAudioCdMetadataCandidate(candidates: AudioCdMetadataInput[], expectedTrackCount: number): AudioCdMetadataInput {
  return (
    candidates.find((candidate) => candidate.tracks.length === expectedTrackCount && Boolean(candidate.coverUrl)) ??
    candidates.find((candidate) => candidate.tracks.length === expectedTrackCount) ??
    candidates.find((candidate) => candidate.albumTitle) ??
    candidates[0]!
  );
}

export function parseDiscIdCommandOutput(output: string): DiscIdCommandResult {
  const discId = output.match(/(?:^|[^A-Za-z0-9._-])([A-Za-z0-9._-]{28})(?=$|[^A-Za-z0-9._-])/)?.[1];
  const toc =
    output
      .split(/\r?\n/)
      .map((line) => line.match(/\btoc\b[^0-9]*(\d+(?:[\s+]+\d+){3,})/i)?.[1])
      .find(Boolean)
      ?.replace(/\s+/g, " ")
      .replace(/\+/g, " ")
      .trim() || undefined;

  return {
    discId,
    toc
  };
}

async function readDiscIdFromCommand(devicePath: string | undefined, timeoutMs = 2500): Promise<DiscIdCommandResult> {
  const attempts = devicePath && devicePath !== "drutil" ? [[devicePath], []] : [[]];
  for (const args of attempts) {
    const result = await runCommand("discid", args, timeoutMs);
    if (result.code === 0) {
      const parsed = parseDiscIdCommandOutput(`${result.stdout}\n${result.stderr}`);
      if (parsed.discId || parsed.toc) {
        return parsed;
      }
    }
  }

  return {};
}

function metadataFromRelease(release: Record<string, unknown> | undefined, expectedTrackCount: number): AudioCdMetadataInput | null {
  if (!release) {
    return null;
  }

  const medium = selectMedium(asArray(release.media), expectedTrackCount);
  if (!medium) {
    return null;
  }

  const releaseId = readString(release.id);
  const albumTitle = readString(release.title);
  const albumArtist = artistCreditName(release["artist-credit"]);
  const tracks = asArray(medium.tracks)
    .map((track, index) => trackMetadataFromMusicBrainzTrack(readRecord(track), index))
    .filter((track): track is NonNullable<ReturnType<typeof trackMetadataFromMusicBrainzTrack>> => Boolean(track));

  if (!albumTitle && !albumArtist && tracks.length === 0) {
    return null;
  }

  return {
    albumTitle,
    albumArtist,
    coverUrl: coverUrlForRelease(release),
    musicBrainzReleaseId: releaseId,
    tracks,
    source: "musicbrainz"
  };
}

function selectMedium(media: unknown[], expectedTrackCount: number): Record<string, unknown> | null {
  const mediaRecords = media.map(readRecord).filter((medium): medium is Record<string, unknown> => Boolean(medium));
  return (
    mediaRecords.find((medium) => mediumTrackCount(medium) === expectedTrackCount) ??
    mediaRecords.find((medium) => /cd/i.test(readString(medium.format) ?? "")) ??
    mediaRecords[0] ??
    null
  );
}

function mediumTrackCount(medium: Record<string, unknown>): number | undefined {
  const directCount = readNumber(medium["track-count"]);
  if (directCount) {
    return directCount;
  }

  const tracks = asArray(medium.tracks);
  return tracks.length || undefined;
}

function trackMetadataFromMusicBrainzTrack(track: Record<string, unknown> | undefined, index: number) {
  if (!track) {
    return null;
  }

  const recording = readRecord(track.recording);
  const number = readNumber(track.position) ?? readNumber(track.number) ?? index + 1;
  const title = readString(track.title) ?? readString(recording?.title);
  const artist = artistCreditName(track["artist-credit"]) ?? artistCreditName(recording?.["artist-credit"]);
  if (!title && !artist) {
    return null;
  }

  return {
    number,
    title,
    artist
  };
}

function artistCreditName(value: unknown): string | undefined {
  const parts = asArray(value)
    .map((part) => {
      const record = readRecord(part);
      if (!record) {
        return "";
      }

      return `${readString(record.name) ?? ""}${readString(record.joinphrase) ?? ""}`;
    })
    .join("")
    .trim();
  return parts || undefined;
}

function coverUrlForRelease(release: Record<string, unknown>): string | undefined {
  const archive = readRecord(release["cover-art-archive"]);
  const releaseId = readString(release.id);
  return archive?.front === true && releaseId ? `https://coverartarchive.org/release/${releaseId}/front-250` : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? number : undefined;
  }

  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const child = execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        code: error ? 1 : 0,
        stdout,
        stderr
      });
    });

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      resolve({
        code: 1,
        stdout: "",
        stderr: `Command timed out after ${timeoutMs}ms.`
      });
    }, timeoutMs);
  });
}
