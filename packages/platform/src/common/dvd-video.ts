import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { DvdTitle, DvdVideoDisc } from "@discstream/contracts";
import { makeError } from "@discstream/contracts";

const DEFAULT_DVD_FFPROBE_TIMEOUT_MS = 12000;
const DEFAULT_DVD_DETAILED_TITLES = 4;
const DEFAULT_DVD_INSPECTION_CACHE_TTL_MS = 5 * 60 * 1000;
const DVD_SECTOR_SIZE_BYTES = 2048;
const VTS_PTT_SRPT_SECTOR_OFFSET = 0xc8;
const VTS_PGCI_SECTOR_OFFSET = 0xcc;
const VTS_AUDIO_COUNT_OFFSET = 0x202;
const VTS_AUDIO_ATTR_OFFSET = 0x204;
const VTS_AUDIO_ATTR_SIZE = 8;
const VTS_SUBTITLE_COUNT_OFFSET = 0x254;
const VTS_SUBTITLE_ATTR_OFFSET = 0x256;
const VTS_SUBTITLE_ATTR_SIZE = 6;
const PGC_PROGRAM_MAP_OFFSET = 0xe6;
const PGC_CELL_PLAYBACK_OFFSET = 0xe8;
const CELL_PLAYBACK_ENTRY_SIZE = 24;

export interface DvdTitleSet {
  title: number;
  files: string[];
  sizeBytes: number;
}

export interface DvdVideoInspectionOptions {
  enableFfprobe?: boolean;
  ffprobeTimeoutMs?: number;
  maxDetailedTitles?: number;
}

interface DvdProbeFormat {
  duration?: string;
  bit_rate?: string;
}

interface DvdProbeStream {
  index?: number;
  id?: string;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  display_aspect_ratio?: string;
  duration?: string;
  channels?: number;
  channel_layout?: string;
  tags?: Record<string, string>;
}

interface DvdProbeChapter {
  start_time?: string;
  end_time?: string;
}

interface DvdProbeJson {
  streams?: DvdProbeStream[];
  format?: DvdProbeFormat;
  chapters?: DvdProbeChapter[];
}

export interface DvdIfoAttributes {
  audioLanguages: Array<string | undefined>;
  subtitleLanguages: Array<string | undefined>;
  chapters?: NonNullable<DvdTitle["chapters"]>;
}

export class DvdVideoInspectionCache {
  private cached:
    | {
        key: string;
        expiresAt: number;
        value: DvdVideoDisc;
      }
    | undefined;

  constructor(
    private readonly ttlMs = DEFAULT_DVD_INSPECTION_CACHE_TTL_MS,
    private readonly options: DvdVideoInspectionOptions = {}
  ) {}

  async inspect(inputPath: string, label?: string, options: DvdVideoInspectionOptions = {}): Promise<DvdVideoDisc> {
    const key = `${path.resolve(inputPath)}:${label ?? ""}`;
    const now = Date.now();
    if (this.cached?.key === key && this.cached.expiresAt > now) {
      return this.cached.value;
    }

    const value = await inspectDvdVideoFolder(inputPath, label, {
      ...this.options,
      ...options
    });
    this.cached = {
      key,
      expiresAt: now + this.ttlMs,
      value
    };
    return value;
  }

  clear(): void {
    this.cached = undefined;
  }
}

export async function inspectDvdVideoFolder(
  inputPath: string,
  label?: string,
  options: DvdVideoInspectionOptions = {}
): Promise<DvdVideoDisc> {
  const videoTsPath = await resolveVideoTsPath(inputPath);
  const titleSets = await findDvdTitleSets(videoTsPath);
  const mainTitle = selectDvdTitleSet(titleSets);
  const titles = await buildDvdTitles(titleSets, mainTitle?.title, options);

  return {
    label,
    mainTitleId: mainTitle?.title,
    titles,
    metadataSource: "none"
  };
}

export async function resolveVideoTsPath(inputPath: string): Promise<string> {
  const stat = await fs.stat(inputPath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw makeError("MEDIA_NOT_READABLE", "DVD playback requires a readable VIDEO_TS folder.", {
      detail: inputPath
    });
  }

  if (path.basename(inputPath).toLowerCase() === "video_ts") {
    return inputPath;
  }

  for (const candidateName of ["VIDEO_TS", "video_ts"]) {
    const candidate = path.join(inputPath, candidateName);
    const candidateStat = await fs.stat(candidate).catch(() => null);
    if (candidateStat?.isDirectory()) {
      return candidate;
    }
  }

  throw makeError("MEDIA_NOT_READABLE", "DVD playback requires a VIDEO_TS folder.", {
    detail: inputPath
  });
}

export async function findDvdTitleSets(videoTsPath: string): Promise<DvdTitleSet[]> {
  const entries = await fs.readdir(videoTsPath, { withFileTypes: true });
  const groups = new Map<number, Array<{ filePath: string; segment: number; sizeBytes: number }>>();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const match = /^VTS_(\d{2})_([1-9]\d*)\.VOB$/i.exec(entry.name);
    if (!match) {
      continue;
    }

    const titleText = match[1];
    const segmentText = match[2];
    if (!titleText || !segmentText) {
      continue;
    }

    const filePath = path.join(videoTsPath, entry.name);
    const stat = await fs.stat(filePath);
    const title = Number(titleText);
    const segment = Number(segmentText);
    const group = groups.get(title) ?? [];
    group.push({ filePath, segment, sizeBytes: stat.size });
    groups.set(title, group);
  }

  return [...groups.entries()]
    .map(([title, files]) => ({
      title,
      files: files.sort((left, right) => left.segment - right.segment).map((file) => file.filePath),
      sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0)
    }))
    .sort((left, right) => left.title - right.title);
}

export function selectDvdTitleSet(titleSets: DvdTitleSet[], requestedTitle?: number): DvdTitleSet | undefined {
  if (requestedTitle) {
    return titleSets.find((set) => set.title === requestedTitle);
  }

  return [...titleSets].sort((left, right) => right.sizeBytes - left.sizeBytes || left.title - right.title)[0];
}

function toDvdTitle(titleSet: DvdTitleSet): DvdTitle {
  return {
    id: titleSet.title
  };
}

async function buildDvdTitles(
  titleSets: DvdTitleSet[],
  mainTitleId: number | undefined,
  options: DvdVideoInspectionOptions
): Promise<DvdTitle[]> {
  if (options.enableFfprobe === false) {
    return titleSets.map(toDvdTitle);
  }

  const maxDetailedTitles = options.maxDetailedTitles ?? DEFAULT_DVD_DETAILED_TITLES;
  const detailedTitles = new Set<number>();
  if (mainTitleId) {
    detailedTitles.add(mainTitleId);
  }

  for (const titleSet of titleSets.slice(0, maxDetailedTitles)) {
    detailedTitles.add(titleSet.title);
  }

  const titles: DvdTitle[] = [];
  for (const titleSet of titleSets) {
    if (!detailedTitles.has(titleSet.title)) {
      titles.push(toDvdTitle(titleSet));
      continue;
    }

    titles.push((await probeDvdTitleSet(titleSet, options.ffprobeTimeoutMs ?? DEFAULT_DVD_FFPROBE_TIMEOUT_MS)) ?? toDvdTitle(titleSet));
  }

  return titles;
}

async function probeDvdTitleSet(titleSet: DvdTitleSet, timeoutMs: number): Promise<DvdTitle | null> {
  const firstFile = titleSet.files[0];
  if (!firstFile) {
    return null;
  }

  const [probe, firstFileStat, ifoAttributes] = await Promise.all([
    runDvdFfprobe(firstFile, timeoutMs),
    fs.stat(firstFile).catch(() => null),
    readDvdIfoAttributes(titleSet)
  ]);
  if (!probe) {
    return null;
  }

  return parseDvdTitleProbe(titleSet, probe, firstFileStat?.size, ifoAttributes);
}

export function parseDvdTitleProbe(
  titleSet: DvdTitleSet,
  probe: DvdProbeJson,
  firstFileSizeBytes?: number,
  ifoAttributes?: DvdIfoAttributes | null
): DvdTitle {
  const ffprobeChapters = parseDvdChapters(probe.chapters);
  const chapters = ffprobeChapters.length ? ffprobeChapters : (ifoAttributes?.chapters ?? []);
  const audioTracks = parseDvdAudioTracks(probe.streams, ifoAttributes?.audioLanguages);
  const subtitleTracks = parseDvdSubtitleTracks(probe.streams, ifoAttributes?.subtitleLanguages);
  const aspectRatio = parseAspectRatio(probe.streams?.find((stream) => stream.codec_type === "video"));
  const durationSeconds = estimateTitleDurationSeconds(titleSet, probe, firstFileSizeBytes);

  return {
    id: titleSet.title,
    durationSeconds,
    chapters: chapters.length ? chapters : undefined,
    audioTracks: audioTracks.length ? audioTracks : undefined,
    subtitleTracks: subtitleTracks.length ? subtitleTracks : undefined,
    aspectRatio
  };
}

async function readDvdIfoAttributes(titleSet: DvdTitleSet): Promise<DvdIfoAttributes | null> {
  const firstFile = titleSet.files[0];
  if (!firstFile) {
    return null;
  }

  const ifoPath = path.join(path.dirname(firstFile), `VTS_${titleSet.title.toString().padStart(2, "0")}_0.IFO`);
  const data = await fs.readFile(ifoPath).catch(() => null);
  return data ? parseDvdIfoAttributes(data) : null;
}

export function parseDvdIfoAttributes(data: Buffer): DvdIfoAttributes | null {
  if (data.length < VTS_SUBTITLE_ATTR_OFFSET || data.subarray(0, 12).toString("latin1") !== "DVDVIDEO-VTS") {
    return null;
  }

  const chapters = parseDvdIfoChapters(data);

  return {
    audioLanguages: parseIfoLanguageAttributes(data, VTS_AUDIO_COUNT_OFFSET, VTS_AUDIO_ATTR_OFFSET, VTS_AUDIO_ATTR_SIZE, 8),
    subtitleLanguages: parseIfoLanguageAttributes(data, VTS_SUBTITLE_COUNT_OFFSET, VTS_SUBTITLE_ATTR_OFFSET, VTS_SUBTITLE_ATTR_SIZE, 32),
    chapters: chapters.length ? chapters : undefined
  };
}

function runDvdFfprobe(filePath: string, timeoutMs: number): Promise<DvdProbeJson | null> {
  return new Promise((resolve) => {
    let settled = false;
    const child = execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-probesize",
        "20M",
        "-analyzeduration",
        "20M",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-show_chapters",
        filePath
      ],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        if (error) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(stdout) as DvdProbeJson);
        } catch {
          resolve(null);
        }
      }
    );

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 1000);
      resolve(null);
    }, timeoutMs);
  });
}

function parseDvdChapters(chapters: DvdProbeChapter[] | undefined): NonNullable<DvdTitle["chapters"]> {
  if (!chapters?.length) {
    return [];
  }

  return chapters
    .map((chapter, index) => {
      const startSeconds = parseSeconds(chapter.start_time);
      const endSeconds = parseSeconds(chapter.end_time);
      return {
        number: index + 1,
        startSeconds: startSeconds !== undefined ? roundSeconds(startSeconds) : undefined,
        durationSeconds:
          startSeconds !== undefined && endSeconds !== undefined && endSeconds >= startSeconds ? roundSeconds(endSeconds - startSeconds) : undefined
      };
    })
    .filter((chapter) => chapter.startSeconds !== undefined || chapter.durationSeconds !== undefined);
}

function parseDvdAudioTracks(
  streams: DvdProbeStream[] | undefined,
  ifoLanguages: Array<string | undefined> | undefined
): NonNullable<DvdTitle["audioTracks"]> {
  return (streams ?? [])
    .filter((stream) => stream.codec_type === "audio")
    .map((stream, index) => ({
      id: streamId(stream, index),
      language: streamLanguage(stream) ?? ifoLanguages?.[index],
      codec: stream.codec_name,
      channels: stream.channel_layout ?? (stream.channels ? `${stream.channels}ch` : undefined)
    }))
    .sort((left, right) => left.id - right.id);
}

function parseDvdSubtitleTracks(
  streams: DvdProbeStream[] | undefined,
  ifoLanguages: Array<string | undefined> | undefined
): NonNullable<DvdTitle["subtitleTracks"]> {
  return (streams ?? [])
    .filter((stream) => stream.codec_type === "subtitle")
    .map((stream, index) => ({
      id: streamId(stream, index),
      language: streamLanguage(stream) ?? ifoLanguages?.[index],
      format: stream.codec_name
    }))
    .sort((left, right) => left.id - right.id);
}

function parseDvdIfoChapters(data: Buffer): NonNullable<DvdTitle["chapters"]> {
  const pttEntries = parseDvdPttEntries(data);
  if (!pttEntries.length) {
    return [];
  }

  const pgciStart = readSectorOffset(data, VTS_PGCI_SECTOR_OFFSET);
  if (pgciStart === undefined) {
    return [];
  }

  const pgcCache = new Map<number, DvdPgcInfo | null>();
  const getPgc = (pgcNumber: number): DvdPgcInfo | null => {
    if (!pgcCache.has(pgcNumber)) {
      pgcCache.set(pgcNumber, parseDvdPgcInfo(data, pgciStart, pgcNumber));
    }

    return pgcCache.get(pgcNumber) ?? null;
  };

  const chapters: NonNullable<DvdTitle["chapters"]> = [];
  for (const [index, entry] of pttEntries.entries()) {
    const pgc = getPgc(entry.pgcNumber);
    const startSeconds = pgc?.programStartSeconds[entry.programNumber - 1];
    if (startSeconds === undefined) {
      continue;
    }

    const nextEntry = pttEntries[index + 1];
    const nextStartSeconds =
      nextEntry?.pgcNumber === entry.pgcNumber ? pgc?.programStartSeconds[nextEntry.programNumber - 1] : undefined;
    const durationSeconds =
      nextStartSeconds !== undefined && nextStartSeconds >= startSeconds
        ? roundSeconds(nextStartSeconds - startSeconds)
        : pgc && pgc.totalDurationSeconds >= startSeconds
          ? roundSeconds(pgc.totalDurationSeconds - startSeconds)
          : undefined;

    chapters.push({
      number: index + 1,
      startSeconds: roundSeconds(startSeconds),
      durationSeconds
    });
  }

  return chapters;
}

interface DvdPttEntry {
  pgcNumber: number;
  programNumber: number;
}

interface DvdPgcInfo {
  programStartSeconds: Array<number | undefined>;
  totalDurationSeconds: number;
}

function parseDvdPttEntries(data: Buffer): DvdPttEntry[] {
  const pttStart = readSectorOffset(data, VTS_PTT_SRPT_SECTOR_OFFSET);
  if (pttStart === undefined || !canRead(data, pttStart, 12)) {
    return [];
  }

  const titleCount = data.readUInt16BE(pttStart);
  if (titleCount < 1 || !canRead(data, pttStart + 8, titleCount * 4)) {
    return [];
  }

  const tableOffset = data.readUInt32BE(pttStart + 8);
  const nextTableOffset = titleCount > 1 ? data.readUInt32BE(pttStart + 12) : data.readUInt32BE(pttStart + 4) + 1;
  if (tableOffset < 12 || nextTableOffset <= tableOffset || !canRead(data, pttStart + tableOffset, nextTableOffset - tableOffset)) {
    return [];
  }

  const entryCount = Math.floor((nextTableOffset - tableOffset) / 4);
  const entries: DvdPttEntry[] = [];
  for (let index = 0; index < entryCount; index++) {
    const offset = pttStart + tableOffset + index * 4;
    const pgcNumber = data.readUInt16BE(offset);
    const programNumber = data.readUInt16BE(offset + 2);
    if (pgcNumber > 0 && programNumber > 0) {
      entries.push({ pgcNumber, programNumber });
    }
  }

  return entries;
}

function parseDvdPgcInfo(data: Buffer, pgciStart: number, pgcNumber: number): DvdPgcInfo | null {
  if (!canRead(data, pgciStart, 8)) {
    return null;
  }

  const pgcCount = data.readUInt16BE(pgciStart);
  const pgcEntryOffset = pgciStart + 8 + (pgcNumber - 1) * 8;
  if (pgcNumber < 1 || pgcNumber > pgcCount || !canRead(data, pgcEntryOffset, 8)) {
    return null;
  }

  const pgcStart = pgciStart + data.readUInt32BE(pgcEntryOffset + 4);
  if (!canRead(data, pgcStart, PGC_CELL_PLAYBACK_OFFSET + 2)) {
    return null;
  }

  const programCount = data.readUInt8(pgcStart + 2);
  const cellCount = data.readUInt8(pgcStart + 3);
  const programMapOffset = data.readUInt16BE(pgcStart + PGC_PROGRAM_MAP_OFFSET);
  const cellPlaybackOffset = data.readUInt16BE(pgcStart + PGC_CELL_PLAYBACK_OFFSET);
  if (
    programCount < 1 ||
    cellCount < 1 ||
    !canRead(data, pgcStart + programMapOffset, programCount) ||
    !canRead(data, pgcStart + cellPlaybackOffset, cellCount * CELL_PLAYBACK_ENTRY_SIZE)
  ) {
    return null;
  }

  const cellStartSeconds = [0];
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    const cellOffset = pgcStart + cellPlaybackOffset + cellIndex * CELL_PLAYBACK_ENTRY_SIZE;
    const durationSeconds = parseDvdBcdTime(data, cellOffset + 4) ?? 0;
    cellStartSeconds.push((cellStartSeconds[cellStartSeconds.length - 1] ?? 0) + durationSeconds);
  }

  const programStartSeconds: Array<number | undefined> = [];
  for (let programIndex = 0; programIndex < programCount; programIndex++) {
    const cellNumber = data.readUInt8(pgcStart + programMapOffset + programIndex);
    programStartSeconds.push(cellNumber >= 1 && cellNumber <= cellCount ? cellStartSeconds[cellNumber - 1] : undefined);
  }

  return {
    programStartSeconds,
    totalDurationSeconds: cellStartSeconds[cellStartSeconds.length - 1] ?? 0
  };
}

function parseIfoLanguageAttributes(
  data: Buffer,
  countOffset: number,
  attrOffset: number,
  attrSize: number,
  maxCount: number
): Array<string | undefined> {
  if (data.length < countOffset + 2) {
    return [];
  }

  const count = Math.min(data.readUInt16BE(countOffset), maxCount);
  const languages: Array<string | undefined> = [];
  for (let index = 0; index < count; index++) {
    const offset = attrOffset + index * attrSize;
    languages.push(readIfoLanguageCode(data, offset, attrSize));
  }

  return languages;
}

function readIfoLanguageCode(data: Buffer, attrOffset: number, attrSize: number): string | undefined {
  if (data.length < attrOffset + attrSize || attrSize < 4) {
    return undefined;
  }

  const language = data.subarray(attrOffset + 2, attrOffset + 4).toString("latin1").toLowerCase();
  return /^[a-z]{2}$/.test(language) ? language : undefined;
}

function parseDvdBcdTime(data: Buffer, offset: number): number | undefined {
  if (!canRead(data, offset, 4)) {
    return undefined;
  }

  const hours = parseBcdByte(data.readUInt8(offset));
  const minutes = parseBcdByte(data.readUInt8(offset + 1));
  const seconds = parseBcdByte(data.readUInt8(offset + 2));
  if (hours === undefined || minutes === undefined || seconds === undefined || minutes > 59 || seconds > 59) {
    return undefined;
  }

  const frameByte = data.readUInt8(offset + 3);
  const frames = parseBcdByte(frameByte & 0x3f) ?? 0;
  const frameRateCode = frameByte >> 6;
  const frameRate = frameRateCode === 1 ? 25 : frameRateCode === 3 ? 30 : undefined;
  const frameSeconds = frameRate && frames < frameRate ? frames / frameRate : 0;

  return hours * 3600 + minutes * 60 + seconds + frameSeconds;
}

function parseBcdByte(value: number): number | undefined {
  const high = (value >> 4) & 0x0f;
  const low = value & 0x0f;
  return high <= 9 && low <= 9 ? high * 10 + low : undefined;
}

function readSectorOffset(data: Buffer, offset: number): number | undefined {
  if (!canRead(data, offset, 4)) {
    return undefined;
  }

  const sector = data.readUInt32BE(offset);
  const byteOffset = sector * DVD_SECTOR_SIZE_BYTES;
  return sector > 0 && byteOffset < data.length ? byteOffset : undefined;
}

function canRead(data: Buffer, offset: number, length: number): boolean {
  return Number.isInteger(offset) && Number.isInteger(length) && offset >= 0 && length >= 0 && offset + length <= data.length;
}

function estimateTitleDurationSeconds(
  titleSet: DvdTitleSet,
  probe: DvdProbeJson,
  firstFileSizeBytes: number | undefined
): number | undefined {
  const firstFileDuration =
    parseSeconds(probe.format?.duration) ??
    maxDefined((probe.streams ?? []).map((stream) => parseSeconds(stream.duration)));
  if (!firstFileDuration) {
    return undefined;
  }

  if (!firstFileSizeBytes || firstFileSizeBytes <= 0 || titleSet.sizeBytes <= firstFileSizeBytes) {
    return roundSeconds(firstFileDuration);
  }

  return roundSeconds(firstFileDuration * (titleSet.sizeBytes / firstFileSizeBytes));
}

function streamId(stream: DvdProbeStream, fallback: number): number {
  if (typeof stream.index === "number" && Number.isInteger(stream.index)) {
    return stream.index;
  }

  if (stream.id) {
    const parsed = stream.id.toLowerCase().startsWith("0x") ? Number.parseInt(stream.id, 16) : Number.parseInt(stream.id, 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function streamLanguage(stream: DvdProbeStream): string | undefined {
  const tags = normalizeTags(stream.tags);
  return tags.language ?? tags.lang;
}

function parseAspectRatio(stream: DvdProbeStream | undefined): string | undefined {
  if (!stream) {
    return undefined;
  }

  if (stream.display_aspect_ratio && stream.display_aspect_ratio !== "0:1") {
    return stream.display_aspect_ratio;
  }

  if (!stream.width || !stream.height) {
    return undefined;
  }

  const divisor = gcd(stream.width, stream.height);
  return `${stream.width / divisor}:${stream.height / divisor}`;
}

function normalizeTags(tags: Record<string, string> | undefined): Record<string, string> {
  if (!tags) {
    return {};
  }

  return Object.fromEntries(Object.entries(tags).map(([key, value]) => [key.toLowerCase(), value]));
}

function parseSeconds(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const filtered = values.filter((value): value is number => value !== undefined);
  return filtered.length ? Math.max(...filtered) : undefined;
}

function roundSeconds(value: number): number {
  return Math.round(value);
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }

  return a || 1;
}
