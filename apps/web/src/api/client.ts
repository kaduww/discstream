import type {
  DiagnosticsResponse,
  DiscInspection,
  DriveStatus,
  DrivesResponse,
  HealthResponse,
  LocalMediaFolderBrowserResponse,
  LocalMediaItem,
  LocalMediaResponse,
  PlatformCapabilities,
  PlaybackSession,
  VideoQualityProfile,
  CurrentSessionResponse
} from "@discstream/contracts";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await readableError(response));
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined;
  const response = await fetch(url, {
    method: "POST",
    headers: hasBody
      ? {
          "Content-Type": "application/json"
        }
      : undefined,
    body: hasBody ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    throw new Error(await readableError(response));
  }
  return response.json() as Promise<T>;
}

async function putJson<T>(url: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined;
  const response = await fetch(url, {
    method: "PUT",
    headers: hasBody
      ? {
          "Content-Type": "application/json"
        }
      : undefined,
    body: hasBody ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    throw new Error(await readableError(response));
  }
  return response.json() as Promise<T>;
}

async function deleteJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await readableError(response));
  }
  return response.json() as Promise<T>;
}

async function readableError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string; hint?: string } };
    return [payload.error?.message, payload.error?.hint].filter(Boolean).join(" ");
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

export interface AppSnapshot {
  health: HealthResponse;
  capabilities: PlatformCapabilities;
  drives: DrivesResponse;
  drive: DriveStatus;
  disc: DiscInspection;
  localMedia: LocalMediaResponse;
  currentSession: PlaybackSession | null;
}

export interface RuntimeStatus {
  drives: DrivesResponse;
  drive: DriveStatus;
  disc: DiscInspection;
  currentSession: PlaybackSession | null;
}

export interface DvdPlaybackOptions {
  title?: number;
  chapter?: number | null;
  startSeconds?: number | null;
  audioTrack?: number;
  subtitleTrack?: number | null;
  videoQuality?: VideoQualityProfile;
}

export interface DvdMetadataChapterInput {
  number: number;
  title?: string;
}

export interface DvdMetadataTitleInput {
  id: number;
  chapters: DvdMetadataChapterInput[];
}

export interface AudioCdTrackMetadataInput {
  number: number;
  title?: string;
  artist?: string;
}

export interface AudioCdMetadataInput {
  albumTitle?: string;
  albumArtist?: string;
  coverUrl?: string;
  musicBrainzReleaseId?: string;
  source?: "musicbrainz" | "manual";
  tracks: AudioCdTrackMetadataInput[];
}

export interface AudioCdMetadataLookupResponse {
  disc: DiscInspection;
  metadata: AudioCdMetadataInput;
  candidates: AudioCdMetadataInput[];
  cached: boolean;
  candidateCount: number;
}

export async function loadSnapshot(): Promise<AppSnapshot> {
  const [health, capabilities, drives, drive, disc, localMedia, currentSession] = await Promise.all([
    getJson<HealthResponse>("/api/health"),
    getJson<PlatformCapabilities>("/api/capabilities"),
    getJson<DrivesResponse>("/api/drives"),
    getJson<DriveStatus>("/api/drive"),
    getJson<DiscInspection>("/api/disc"),
    getJson<LocalMediaResponse>("/api/local-media"),
    getJson<CurrentSessionResponse>("/api/sessions/current").then((response) => response.session)
  ]);

  return { health, capabilities, drives, drive, disc, localMedia, currentSession };
}

export async function loadRuntimeStatus(): Promise<RuntimeStatus> {
  return getJson<RuntimeStatus>("/api/runtime");
}

export function openRuntimeStatusSocket(
  onStatus: (status: RuntimeStatus) => void,
  onError: (message: string) => void
): WebSocket {
  const socket = new WebSocket(runtimeStatusSocketUrl());
  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data)) as
        | { type: "runtime-status"; payload: RuntimeStatus }
        | { type: "error"; message: string };
      if (message.type === "runtime-status") {
        onStatus(message.payload);
        return;
      }

      if (message.type === "error") {
        onError(message.message);
      }
    } catch {
      onError("Runtime status update could not be read.");
    }
  });

  return socket;
}

export function playLocalMedia(item: LocalMediaItem, options: DvdPlaybackOptions = {}): Promise<PlaybackSession> {
  const mediaType =
    item.mediaType === "video-file" ? "local-video" : item.mediaType === "dvd-video-folder" ? "local-dvd-video" : "local-audio";

  return postJson<PlaybackSession>("/api/sessions", {
    mediaType,
    localMediaId: item.id,
    title: options.title,
    chapter: options.chapter,
    startSeconds: options.startSeconds,
    audioTrack: options.audioTrack,
    subtitleTrack: options.subtitleTrack,
    videoQuality: options.videoQuality,
    replace: true
  });
}

export function playAudioCd(driveId: string | undefined, track = 1, startSeconds?: number | null): Promise<PlaybackSession> {
  return postJson<PlaybackSession>("/api/sessions", {
    mediaType: "audio-cd",
    driveId,
    track,
    startSeconds,
    replace: true
  });
}

export function playDvdVideo(driveId: string | undefined, options: DvdPlaybackOptions = {}): Promise<PlaybackSession> {
  return postJson<PlaybackSession>("/api/sessions", {
    mediaType: "dvd-video",
    driveId,
    title: options.title,
    chapter: options.chapter,
    startSeconds: options.startSeconds,
    audioTrack: options.audioTrack,
    subtitleTrack: options.subtitleTrack,
    videoQuality: options.videoQuality,
    replace: true
  });
}

export async function saveCurrentDvdMetadata(titles: DvdMetadataTitleInput[]): Promise<DiscInspection> {
  const response = await putJson<{ disc: DiscInspection }>("/api/dvd-metadata/current", {
    titles
  });
  return response.disc;
}

export function lookupCurrentAudioCdMetadata(): Promise<AudioCdMetadataLookupResponse> {
  return postJson<AudioCdMetadataLookupResponse>("/api/audio-cd-metadata/current/lookup");
}

export async function saveCurrentAudioCdMetadata(metadata: AudioCdMetadataInput): Promise<DiscInspection> {
  const response = await putJson<{ disc: DiscInspection }>("/api/audio-cd-metadata/current", metadata);
  return response.disc;
}

export function addLocalMediaRoot(path: string): Promise<LocalMediaResponse> {
  return postJson<LocalMediaResponse>("/api/local-media/roots", { path });
}

export function loadLocalMediaFolders(path?: string): Promise<LocalMediaFolderBrowserResponse> {
  const params = new URLSearchParams();
  if (path) {
    params.set("path", path);
  }

  return getJson<LocalMediaFolderBrowserResponse>(`/api/local-media/folders${params.size ? `?${params.toString()}` : ""}`);
}

export function removeLocalMediaRoot(rootId: string): Promise<LocalMediaResponse> {
  return deleteJson<LocalMediaResponse>(`/api/local-media/roots/${encodeURIComponent(rootId)}`);
}

export async function ejectDrive(): Promise<void> {
  await postJson<{ ok: true }>("/api/drive/eject");
}

export async function stopSession(): Promise<void> {
  await postJson("/api/sessions/current/stop");
}

export function loadDiagnostics(): Promise<DiagnosticsResponse> {
  return getJson<DiagnosticsResponse>("/api/diagnostics");
}

function runtimeStatusSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/runtime`;
}
