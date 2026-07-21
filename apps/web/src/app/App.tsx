import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  ChevronUp,
  CircleAlert,
  Disc3,
  DoorOpen,
  FileMusic,
  Folder,
  FolderPlus,
  MonitorPlay,
  Pause,
  Pencil,
  Play,
  RefreshCcw,
  Save,
  Search,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  Wrench,
  X
} from "lucide-react";
import type {
  DiagnosticsResponse,
  DiscInspection,
  LocalMediaFolderBrowserResponse,
  LocalMediaItem,
  PlaybackSession,
  VideoQualityProfile
} from "@discstream/contracts";
import type Hls from "hls.js";
import {
  addLocalMediaRoot,
  ejectDrive,
  loadDiagnostics,
  loadLocalMediaFolders,
  loadSnapshot,
  lookupCurrentAudioCdMetadata,
  openRuntimeStatusSocket,
  playAudioCd,
  playDvdVideo,
  playLocalMedia,
  removeLocalMediaRoot,
  saveCurrentAudioCdMetadata,
  saveCurrentDvdMetadata,
  type AudioCdMetadataInput,
  stopSession,
  type DvdMetadataTitleInput,
  type DvdPlaybackOptions,
  type RuntimeStatus,
  type AppSnapshot
} from "../api/client.js";

type LoadState = "loading" | "ready" | "error";

interface PlaybackResumeEntry {
  key: string;
  label: string;
  mediaType: PlaybackSession["mediaType"];
  positionSeconds: number;
  durationSeconds?: number;
  updatedAt: string;
}

type PlaybackResumeHistory = Record<string, PlaybackResumeEntry>;
type LocalMediaFilter = "all" | "audio" | "video" | "dvd";
type LocalMediaSort = "name" | "type" | "duration";
type HlsConstructor = typeof import("hls.js").default;
type HlsErrorData = {
  fatal?: boolean;
  type?: string;
  details?: string;
};

interface LocalMediaGroup {
  key: string;
  rootName: string;
  directoryLabel: string;
  items: LocalMediaItem[];
}

const PLAYBACK_HISTORY_STORAGE_KEY = "discstream.playbackHistory.v1";
const COLLAPSED_LOCAL_MEDIA_GROUPS_STORAGE_KEY = "discstream.collapsedLocalMediaGroups.v1";
const VIDEO_QUALITY_STORAGE_KEY = "discstream.videoQuality.v1";
const TV_MODE_STORAGE_KEY = "discstream.tvMode.v1";
const RESUME_MIN_SECONDS = 8;
const RESUME_END_GUARD_SECONDS = 10;

const LANGUAGE_CODE_ALIASES: Record<string, string> = {
  eng: "en",
  en: "en",
  por: "pt",
  pt: "pt",
  spa: "es",
  es: "es",
  fre: "fr",
  fra: "fr",
  fr: "fr",
  ger: "de",
  deu: "de",
  de: "de",
  ita: "it",
  it: "it",
  jpn: "ja",
  ja: "ja",
  chi: "zh",
  zho: "zh",
  zh: "zh",
  kor: "ko",
  ko: "ko"
};

const LANGUAGE_LABELS: Record<string, string> = {
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  zh: "Chinese"
};

export function App() {
  const [state, setState] = useState<LoadState>("loading");
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingMediaId, setPendingMediaId] = useState<string | null>(null);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [folderBrowser, setFolderBrowser] = useState<LocalMediaFolderBrowserResponse | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);
  const [rootAdding, setRootAdding] = useState(false);
  const [pendingRootId, setPendingRootId] = useState<string | null>(null);
  const [ejecting, setEjecting] = useState(false);
  const [pendingAudioCdTrack, setPendingAudioCdTrack] = useState<number | null>(null);
  const [audioCdMetadataLoading, setAudioCdMetadataLoading] = useState(false);
  const [audioCdMetadataCandidates, setAudioCdMetadataCandidates] = useState<AudioCdMetadataInput[]>([]);
  const [pendingDvdTitle, setPendingDvdTitle] = useState<number | "auto" | null>(null);
  const [selectedDvdTitle, setSelectedDvdTitle] = useState<number | undefined>(undefined);
  const [selectedDvdAudioTrack, setSelectedDvdAudioTrack] = useState<number | undefined>(undefined);
  const [selectedDvdSubtitleTrack, setSelectedDvdSubtitleTrack] = useState<number | null>(null);
  const [selectedDvdChapter, setSelectedDvdChapter] = useState<number | null>(null);
  const [selectedDvdVideoQuality, setSelectedDvdVideoQuality] = useState<VideoQualityProfile>(() => loadVideoQualityPreference());
  const [playbackHistory, setPlaybackHistory] = useState<PlaybackResumeHistory>(() => loadPlaybackHistory());
  const [localMediaQuery, setLocalMediaQuery] = useState("");
  const [localMediaFilter, setLocalMediaFilter] = useState<LocalMediaFilter>("all");
  const [localMediaSort, setLocalMediaSort] = useState<LocalMediaSort>("name");
  const [selectedLocalMediaGroup, setSelectedLocalMediaGroup] = useState("all");
  const [localMediaRefreshing, setLocalMediaRefreshing] = useState(false);
  const [tvMode, setTvMode] = useState(() => loadTvModePreference());
  const [collapsedLocalMediaGroups, setCollapsedLocalMediaGroups] = useState<Set<string>>(() => loadCollapsedLocalMediaGroups());

  const refresh = async () => {
    try {
      setState((current) => (current === "ready" ? "ready" : "loading"));
      const nextSnapshot = await loadSnapshot();
      setSnapshot(nextSnapshot);
      setError(null);
      setState("ready");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "DiscStream is not reachable.");
      setState("error");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (state !== "ready") {
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;

    const connect = () => {
      socket = openRuntimeStatusSocket(
        (status) => {
          applyRuntimeStatus(status);
          setError(null);
        },
        (message) => {
          setError(message);
        }
      );

      socket.addEventListener("close", () => {
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      });
      socket.addEventListener("error", () => {
        if (!disposed) {
          setError("Live status connection was interrupted.");
        }
      });
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [state]);

  const localItems = snapshot?.localMedia.items ?? [];
  const localMediaSearchTerm = localMediaQuery.trim().toLowerCase();
  const localMediaSearchActive = localMediaSearchTerm.length > 0;
  const playableLocalItems = useMemo(
    () => localItems.filter((item) => item.mediaType === "audio-file" || item.mediaType === "video-file" || item.mediaType === "dvd-video-folder"),
    [localItems]
  );
  const visibleLocalItems = useMemo(
    () =>
      [...playableLocalItems]
        .filter((item) => localMediaFilterMatches(item, localMediaFilter))
        .filter((item) => localMediaSearchText(item).includes(localMediaSearchTerm))
        .sort((left, right) => sortLocalMediaItems(left, right, localMediaSort)),
    [localMediaFilter, localMediaSearchTerm, localMediaSort, playableLocalItems]
  );
  const visibleLocalGroups = useMemo(
    () => groupLocalMediaItems(visibleLocalItems, snapshot?.localMedia.roots ?? []),
    [snapshot?.localMedia.roots, visibleLocalItems]
  );
  const displayedLocalGroups = useMemo(
    () =>
      selectedLocalMediaGroup === "all"
        ? visibleLocalGroups
        : visibleLocalGroups.filter((group) => group.key === selectedLocalMediaGroup),
    [selectedLocalMediaGroup, visibleLocalGroups]
  );
  const displayedLocalItemCount = useMemo(
    () => displayedLocalGroups.reduce((total, group) => total + group.items.length, 0),
    [displayedLocalGroups]
  );
  const currentDrive = snapshot?.drives.drives[0];
  const canEject = Boolean(currentDrive?.capabilities.eject) && snapshot?.drive.status !== "no-drive";
  const canPlayAudioCd = Boolean(currentDrive) && snapshot?.disc.type === "audio-cd";
  const canPlayDvd = Boolean(currentDrive) && snapshot?.disc.type === "dvd-video";
  const firstAudioCdTrack = snapshot?.disc.audioCd?.tracks[0]?.number ?? 1;
  const activeAudioCdTrack = snapshot?.currentSession?.mediaType === "audio-cd" ? (snapshot.currentSession.track ?? null) : null;
  const dvdTitles = snapshot?.disc.dvdVideo?.titles ?? [];
  const mainDvdTitle = snapshot?.disc.dvdVideo?.mainTitleId;
  const selectedDvdTitleId = selectedDvdTitle ?? mainDvdTitle ?? dvdTitles[0]?.id;
  const selectedDvdTitleDetails = dvdTitles.find((title) => title.id === selectedDvdTitleId) ?? dvdTitles[0];
  const selectedDvdChapterDetails = selectedDvdTitleDetails?.chapters?.find((chapter) => chapter.number === selectedDvdChapter);
  const selectedDvdPlaybackOptions: DvdPlaybackOptions = {
    title: selectedDvdTitleId,
    chapter: selectedDvdChapter,
    startSeconds: selectedDvdChapterDetails?.startSeconds,
    audioTrack: selectedDvdAudioTrack,
    subtitleTrack: selectedDvdSubtitleTrack,
    videoQuality: selectedDvdVideoQuality
  };
  const selectedDvdResumeKey =
    snapshot?.disc.type === "dvd-video" && selectedDvdTitleId ? dvdPlaybackKey(snapshot.disc, selectedDvdTitleId) : null;
  const selectedDvdResume = resumeEntryFor(playbackHistory, selectedDvdResumeKey);
  const audioCdResume = latestAudioCdResume(snapshot?.disc, playbackHistory);
  const currentPlaybackKey = snapshot ? playbackKeyForSession(snapshot.currentSession, snapshot) : null;
  const currentPlaybackLabel = snapshot ? playbackLabelForSession(snapshot.currentSession, snapshot) : undefined;
  const dvdSelectionKey =
    snapshot?.disc.type === "dvd-video"
      ? [snapshot.disc.label, snapshot.disc.dvdVideo?.mainTitleId, dvdTitles.map((title) => title.id).join(",")].join(":")
      : "no-dvd";
  const audioCdSelectionKey = snapshot?.disc.type === "audio-cd" ? audioCdFingerprint(snapshot.disc) : "no-audio-cd";

  useEffect(() => {
    setSelectedDvdTitle(undefined);
    setSelectedDvdAudioTrack(undefined);
    setSelectedDvdSubtitleTrack(null);
    setSelectedDvdChapter(null);
  }, [dvdSelectionKey]);

  useEffect(() => {
    setAudioCdMetadataCandidates([]);
  }, [audioCdSelectionKey]);

  useEffect(() => {
    if (selectedDvdAudioTrack !== undefined && !selectedDvdTitleDetails?.audioTracks?.some((track) => track.id === selectedDvdAudioTrack)) {
      setSelectedDvdAudioTrack(undefined);
    }

    if (
      selectedDvdSubtitleTrack !== null &&
      !selectedDvdTitleDetails?.subtitleTracks?.some((track) => track.id === selectedDvdSubtitleTrack)
    ) {
      setSelectedDvdSubtitleTrack(null);
    }

    if (selectedDvdChapter !== null && !selectedDvdTitleDetails?.chapters?.some((chapter) => chapter.number === selectedDvdChapter)) {
      setSelectedDvdChapter(null);
    }
  }, [selectedDvdAudioTrack, selectedDvdSubtitleTrack, selectedDvdChapter, selectedDvdTitleDetails]);

  useEffect(() => {
    if (selectedLocalMediaGroup === "all") {
      return;
    }

    if (!visibleLocalGroups.some((group) => group.key === selectedLocalMediaGroup)) {
      setSelectedLocalMediaGroup("all");
    }
  }, [selectedLocalMediaGroup, visibleLocalGroups]);

  const applyRuntimeStatus = (status: RuntimeStatus) => {
    setSnapshot((current) =>
      current
        ? {
            ...current,
            drives: status.drives,
            drive: status.drive,
            disc: status.disc,
            currentSession: status.currentSession
          }
        : current
    );
  };

  const handlePlaybackProgress = useCallback((entry: PlaybackResumeEntry) => {
    setPlaybackHistory((current) => savePlaybackHistory(updatePlaybackHistory(current, entry)));
  }, []);

  const handlePlayLocal = async (item: LocalMediaItem, startSeconds?: number) => {
    try {
      setPendingMediaId(item.id);
      const session = await playLocalMedia(item, { startSeconds });
      setSnapshot((current) => (current ? { ...current, currentSession: session } : current));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Playback failed.");
    } finally {
      setPendingMediaId(null);
    }
  };

  const handleStop = async () => {
    setSnapshot((current) => (current ? { ...current, currentSession: null } : current));

    try {
      await stopSession();
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Stop failed.");
    }
  };

  const handlePlayAudioCd = async (track = 1, startSeconds?: number) => {
    if (!currentDrive) {
      return;
    }

    try {
      setPendingAudioCdTrack(track);
      const session = await playAudioCd(currentDrive.id, track, startSeconds);
      setSnapshot((current) => (current ? { ...current, currentSession: session } : current));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Audio CD playback failed.");
    } finally {
      setPendingAudioCdTrack(null);
    }
  };

  const handlePlayDvd = async (options: DvdPlaybackOptions = {}) => {
    if (!currentDrive) {
      return;
    }

    const title = options.title;
    try {
      setPendingDvdTitle(title ?? "auto");
      const session = await playDvdVideo(currentDrive.id, options);
      if (options.videoQuality) {
        saveVideoQualityPreference(options.videoQuality);
      }
      setSnapshot((current) => (current ? { ...current, currentSession: session } : current));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "DVD playback failed.");
    } finally {
      setPendingDvdTitle(null);
    }
  };

  const handleSaveDvdMetadata = async (titles: DvdMetadataTitleInput[]) => {
    try {
      const disc = await saveCurrentDvdMetadata(titles);
      setSnapshot((current) => (current ? { ...current, disc } : current));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "DVD chapter names could not be saved.");
      throw nextError;
    }
  };

  const handleLookupAudioCdMetadata = async () => {
    try {
      setAudioCdMetadataLoading(true);
      const response = await lookupCurrentAudioCdMetadata();
      setAudioCdMetadataCandidates(response.cached ? [] : response.candidates);
      setSnapshot((current) => (current ? { ...current, disc: response.disc } : current));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Audio CD metadata could not be loaded.");
    } finally {
      setAudioCdMetadataLoading(false);
    }
  };

  const handleSaveAudioCdMetadata = async (metadata: AudioCdMetadataInput) => {
    try {
      const disc = await saveCurrentAudioCdMetadata(metadata);
      setAudioCdMetadataCandidates([]);
      setSnapshot((current) => (current ? { ...current, disc } : current));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Audio CD metadata could not be saved.");
      throw nextError;
    }
  };

  const handleEject = async () => {
    try {
      setEjecting(true);
      await ejectDrive();
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Eject failed.");
    } finally {
      setEjecting(false);
    }
  };

  const loadFolderBrowser = async (path?: string) => {
    try {
      setFolderLoading(true);
      const listing = await loadLocalMediaFolders(path);
      setFolderBrowser(listing);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Server folders could not be loaded.");
    } finally {
      setFolderLoading(false);
    }
  };

  const handleChooseRoot = async () => {
    setFolderBrowserOpen(true);
    await loadFolderBrowser();
  };

  const handleAddCurrentFolder = async () => {
    if (!folderBrowser) {
      return;
    }

    try {
      setRootAdding(true);
      const localMedia = await addLocalMediaRoot(folderBrowser.currentPath);
      setSnapshot((current) => (current ? { ...current, localMedia } : current));
      setFolderBrowserOpen(false);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Local media folder could not be added.");
    } finally {
      setRootAdding(false);
    }
  };

  const handleRemoveRoot = async (rootId: string) => {
    try {
      setPendingRootId(rootId);
      const localMedia = await removeLocalMediaRoot(rootId);
      setSnapshot((current) => (current ? { ...current, localMedia } : current));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Local media folder could not be removed.");
    } finally {
      setPendingRootId(null);
    }
  };

  const handleRefreshLocalMedia = async () => {
    try {
      setLocalMediaRefreshing(true);
      const nextSnapshot = await loadSnapshot();
      setSnapshot(nextSnapshot);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Local media could not be refreshed.");
    } finally {
      setLocalMediaRefreshing(false);
    }
  };

  const loadDiagnosticsPanel = async () => {
    setDiagnostics(await loadDiagnostics());
  };

  const toggleLocalMediaGroup = (groupKey: string) => {
    setCollapsedLocalMediaGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }

      saveCollapsedLocalMediaGroups(next);
      return next;
    });
  };

  const setDisplayedLocalGroupsCollapsed = (collapsed: boolean) => {
    setCollapsedLocalMediaGroups((current) => {
      const next = new Set(current);
      for (const group of displayedLocalGroups) {
        if (collapsed) {
          next.add(group.key);
        } else {
          next.delete(group.key);
        }
      }

      saveCollapsedLocalMediaGroups(next);
      return next;
    });
  };

  const toggleTvMode = () => {
    setTvMode((current) => {
      const next = !current;
      saveTvModePreference(next);
      return next;
    });
  };

  return (
    <main className={`app-shell ${tvMode ? "tv-mode" : ""}`}>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <Disc3 size={28} />
        </div>
        <div>
          <h1>DiscStream</h1>
          <p>{snapshot ? statusLine(snapshot) : "Warming up"}</p>
        </div>
        <button
          className={`icon-button ${tvMode ? "is-active" : ""}`}
          type="button"
          onClick={toggleTvMode}
          aria-pressed={tvMode}
          aria-label={tvMode ? "Turn off TV mode" : "Turn on TV mode"}
          title={tvMode ? "Turn off TV mode" : "Turn on TV mode"}
        >
          <MonitorPlay size={18} />
        </button>
        <button className="icon-button" type="button" onClick={refresh} aria-label="Refresh status" title="Refresh status">
          <RefreshCcw size={18} />
        </button>
      </header>

      {error ? (
        <div className="notice error-notice" role="alert">
          <CircleAlert size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="deck-grid" aria-busy={state === "loading"}>
        <div className="disc-stage">
          <div className={`disc-plate ${snapshot?.drive.status === "media-present" ? "is-loaded" : ""}`}>
            <div className="disc-hole" />
          </div>
          <div className="stage-copy">
            <div className="disc-summary">
              <span className="eyebrow">Disc tray</span>
              <h2>{discHeading(snapshot)}</h2>
              <p>{discMessage(snapshot)}</p>
              {snapshot ? <DiscDetails disc={snapshot.disc} /> : null}
              <div className="stage-actions">
                {snapshot?.disc.type === "dvd-video" && !snapshot.disc.dvdVideo?.titles.length ? (
                  <button
                    className="action-button"
                    type="button"
                    onClick={() => {
                      void handlePlayDvd(selectedDvdPlaybackOptions);
                    }}
                    disabled={!canPlayDvd || pendingDvdTitle !== null}
                  >
                    {pendingDvdTitle === (selectedDvdTitleId ?? "auto") ? <span className="button-spinner" aria-hidden="true" /> : <Play size={18} />}
                    <span>
                      {pendingDvdTitle === (selectedDvdTitleId ?? "auto")
                        ? "Starting"
                        : selectedDvdTitleId
                          ? `Play Title ${selectedDvdTitleId}`
                          : "Play DVD"}
                    </span>
                  </button>
                ) : snapshot?.disc.type === "dvd-video" ? null : (
                  <button
                    className="action-button"
                    type="button"
                    onClick={() => {
                      void handlePlayAudioCd(firstAudioCdTrack);
                    }}
                    disabled={!canPlayAudioCd || pendingAudioCdTrack !== null}
                  >
                    {pendingAudioCdTrack === firstAudioCdTrack ? <span className="button-spinner" aria-hidden="true" /> : <Play size={18} />}
                    <span>{pendingAudioCdTrack === firstAudioCdTrack ? "Starting" : "Play CD"}</span>
                  </button>
                )}
                {snapshot?.disc.type === "dvd-video" && selectedDvdResume ? (
                  <button
                    className="action-button secondary"
                    type="button"
                    onClick={() => {
                      void handlePlayDvd({
                        ...selectedDvdPlaybackOptions,
                        chapter: null,
                        startSeconds: selectedDvdResume.positionSeconds
                      });
                    }}
                    disabled={!canPlayDvd || pendingDvdTitle !== null}
                    title={`Resume at ${formatPlaybackTime(selectedDvdResume.positionSeconds)}`}
                  >
                    <RefreshCcw size={18} />
                    <span>Resume</span>
                  </button>
                ) : null}
                <button className="action-button secondary" type="button" onClick={handleEject} disabled={!canEject || ejecting}>
                  {ejecting ? <span className="button-spinner" aria-hidden="true" /> : <DoorOpen size={18} />}
                  <span>{ejecting ? "Ejecting" : "Eject"}</span>
                </button>
              </div>
            </div>
            {snapshot ? (
              <>
                <AudioCdTracks
                  disc={snapshot.disc}
                  pendingTrack={pendingAudioCdTrack}
                  activeTrack={activeAudioCdTrack}
                  resumeEntry={audioCdResume}
                  metadataLoading={audioCdMetadataLoading}
                  metadataCandidates={audioCdMetadataCandidates}
                  onPlay={(track) => {
                    void handlePlayAudioCd(track);
                  }}
                  onLookupMetadata={() => {
                    void handleLookupAudioCdMetadata();
                  }}
                  onResume={(track, startSeconds) => {
                    void handlePlayAudioCd(track, startSeconds);
                  }}
                  onSaveMetadata={handleSaveAudioCdMetadata}
                />
                <DvdTitles
                  disc={snapshot.disc}
                  pendingTitle={pendingDvdTitle}
                  selectedTitle={selectedDvdTitleId}
                  selectedAudioTrack={selectedDvdAudioTrack}
                  selectedSubtitleTrack={selectedDvdSubtitleTrack}
                  selectedVideoQuality={selectedDvdVideoQuality}
                  onSelectTitle={(title) => {
                    setSelectedDvdTitle(title);
                    setSelectedDvdAudioTrack(undefined);
                    setSelectedDvdSubtitleTrack(null);
                    setSelectedDvdChapter(null);
                  }}
                  onSelectAudioTrack={setSelectedDvdAudioTrack}
                  onSelectSubtitleTrack={setSelectedDvdSubtitleTrack}
                  onSelectVideoQuality={(quality) => {
                    setSelectedDvdVideoQuality(quality);
                    saveVideoQualityPreference(quality);
                  }}
                  selectedChapter={selectedDvdChapter}
                  onSelectChapter={setSelectedDvdChapter}
                  onSaveMetadata={handleSaveDvdMetadata}
                  onPlay={(options) => {
                    void handlePlayDvd(options);
                  }}
                />
              </>
            ) : null}
          </div>
        </div>

        <PlayerPanel
          session={snapshot?.currentSession ?? null}
          audioCdTracks={snapshot?.disc.type === "audio-cd" ? (snapshot.disc.audioCd?.tracks ?? []) : []}
          pendingAudioCdTrack={pendingAudioCdTrack}
          playbackKey={currentPlaybackKey}
          playbackLabel={currentPlaybackLabel}
          onPlaybackProgress={handlePlaybackProgress}
          onPlayAudioCdTrack={(track) => {
            void handlePlayAudioCd(track);
          }}
          onStop={handleStop}
        />
      </section>

      <section className="source-layout">
        <div className="source-header">
          <div>
            <span className="eyebrow">Library</span>
            <h2>Media shelf</h2>
          </div>
          <span className="pill">
            {localMediaShelfCountLabel(
              playableLocalItems.length,
              visibleLocalItems.length,
              displayedLocalItemCount,
              selectedLocalMediaGroup !== "all"
            )}
          </span>
        </div>

        <div className="root-actions">
          <button className="action-button secondary" type="button" onClick={handleRefreshLocalMedia} disabled={localMediaRefreshing}>
            {localMediaRefreshing ? <span className="button-spinner" aria-hidden="true" /> : <RefreshCcw size={18} />}
            <span>{localMediaRefreshing ? "Scanning" : "Refresh shelf"}</span>
          </button>
          <button className="action-button" type="button" onClick={handleChooseRoot} disabled={folderLoading}>
            {folderLoading && !folderBrowserOpen ? <span className="button-spinner" aria-hidden="true" /> : <FolderPlus size={18} />}
            <span>Add folder</span>
          </button>
        </div>

        {playableLocalItems.length > 0 ? (
          <div className="media-controls" aria-label="Local media controls">
            <label className="media-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={localMediaQuery}
                onChange={(event) => {
                  setLocalMediaQuery(event.currentTarget.value);
                }}
                placeholder="Search media"
                aria-label="Search local media"
              />
            </label>
            <div className="segmented-control" aria-label="Media type">
              {(["all", "audio", "video", "dvd"] as const).map((filter) => (
                <button
                  className={localMediaFilter === filter ? "is-selected" : ""}
                  type="button"
                  key={filter}
                  onClick={() => {
                    setLocalMediaFilter(filter);
                  }}
                  aria-pressed={localMediaFilter === filter}
                >
                  {localMediaFilterLabel(filter)}
                </button>
              ))}
            </div>
            <label className="media-sort">
              <span>Sort</span>
              <select
                value={localMediaSort}
                onChange={(event) => {
                  setLocalMediaSort(event.currentTarget.value as LocalMediaSort);
                }}
                aria-label="Sort local media"
              >
                <option value="name">Name</option>
                <option value="type">Type</option>
                <option value="duration">Duration</option>
              </select>
            </label>
            <label className="media-folder-select">
              <span className="media-folder-label">
                <Folder size={15} aria-hidden="true" />
                <span>Folder</span>
              </span>
              <select
                value={selectedLocalMediaGroup}
                onChange={(event) => {
                  setSelectedLocalMediaGroup(event.currentTarget.value);
                }}
                aria-label="Filter local media folder"
              >
                <option value="all">All folders</option>
                {visibleLocalGroups.map((group) => (
                  <option value={group.key} key={group.key}>
                    {localMediaGroupSelectLabel(group)}
                  </option>
                ))}
              </select>
            </label>
            <div className="media-group-actions" aria-label="Folder view">
              <button
                type="button"
                onClick={() => {
                  setDisplayedLocalGroupsCollapsed(false);
                }}
                disabled={displayedLocalGroups.length === 0 || localMediaSearchActive}
                title={localMediaSearchActive ? "Clear search to change folder expansion" : "Expand visible folders"}
              >
                <ChevronUp size={16} aria-hidden="true" />
                <span>Expand</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDisplayedLocalGroupsCollapsed(true);
                }}
                disabled={displayedLocalGroups.length === 0 || localMediaSearchActive}
                title={localMediaSearchActive ? "Clear search to change folder expansion" : "Collapse visible folders"}
              >
                <ChevronUp className="is-down" size={16} aria-hidden="true" />
                <span>Collapse</span>
              </button>
            </div>
          </div>
        ) : null}

        {folderBrowserOpen ? (
          <FolderBrowser
            listing={folderBrowser}
            loading={folderLoading}
            adding={rootAdding}
            onNavigate={(path) => {
              void loadFolderBrowser(path);
            }}
            onAdd={() => {
              void handleAddCurrentFolder();
            }}
            onClose={() => {
              setFolderBrowserOpen(false);
            }}
          />
        ) : null}

        {snapshot?.localMedia.roots.length ? (
          <div className="root-list" aria-label="Configured local media folders">
            {snapshot.localMedia.roots.map((root) => (
              <span className="root-chip" key={root.id}>
                <span>{root.displayName}</span>
                <button
                  className="chip-button"
                  type="button"
                  onClick={() => {
                    void handleRemoveRoot(root.id);
                  }}
                  disabled={pendingRootId === root.id}
                  aria-label={`Remove ${root.displayName}`}
                  title={`Remove ${root.displayName}`}
                >
                  {pendingRootId === root.id ? <span className="button-spinner small" aria-hidden="true" /> : <Trash2 size={14} />}
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {playableLocalItems.length === 0 ? (
          <div className="empty-state">
            <FileMusic size={22} />
            <p>No local media is available.</p>
          </div>
        ) : displayedLocalItemCount === 0 ? (
          <div className="empty-state">
            <Search size={22} />
            <p>No local media matches.</p>
          </div>
        ) : (
          <div className="media-groups">
            {displayedLocalGroups.map((group) => {
              const collapsed = !localMediaSearchActive && collapsedLocalMediaGroups.has(group.key);
              const summary = localMediaGroupSummary(group);
              return (
                <section className={`media-group ${collapsed ? "is-collapsed" : ""}`} key={group.key}>
                  <button
                    className="media-group-header"
                    type="button"
                    onClick={() => {
                      toggleLocalMediaGroup(group.key);
                    }}
                    aria-expanded={!collapsed}
                  >
                    <Folder size={18} />
                    <span className="media-group-copy">
                      <span className="media-group-title">{group.directoryLabel}</span>
                      <small className="media-group-root">{group.rootName}</small>
                      <span className="media-group-metrics">
                        {summary.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </span>
                    </span>
                    <ChevronUp className="media-group-chevron" size={18} aria-hidden="true" />
                  </button>
                  {!collapsed ? (
                    <div className="media-list">
                      {group.items.map((item) => {
                        const resume = resumeEntryFor(playbackHistory, localMediaPlaybackKey(item));
                        return (
                          <LocalMediaRow
                            key={item.id}
                            item={item}
                            pending={pendingMediaId === item.id}
                            resumePosition={resume?.positionSeconds}
                            onResume={() => {
                              void handlePlayLocal(item, resume?.positionSeconds);
                            }}
                            onPlay={() => {
                              void handlePlayLocal(item);
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </section>

      <section className="diagnostics">
        <button className="action-button secondary" type="button" onClick={loadDiagnosticsPanel}>
          <Wrench size={18} />
          <span>System check</span>
        </button>
        {diagnostics ? <DiagnosticsPanel diagnostics={diagnostics} /> : null}
      </section>
    </main>
  );
}

function DiscDetails({ disc }: { disc: DiscInspection }) {
  if (disc.type === "none") {
    return null;
  }

  return (
    <div className="disc-facts">
      <span>{discTypeLabel(disc.type)}</span>
      {disc.label ? <span>{disc.label}</span> : null}
      {disc.audioCd?.albumArtist ? <span>{disc.audioCd.albumArtist}</span> : null}
      {disc.dvdVideo?.titles.length ? <span>{disc.dvdVideo.titles.length} titles</span> : null}
    </div>
  );
}

function DvdTitles({
  disc,
  pendingTitle,
  selectedTitle,
  selectedAudioTrack,
  selectedSubtitleTrack,
  selectedVideoQuality,
  selectedChapter,
  onSelectTitle,
  onSelectAudioTrack,
  onSelectSubtitleTrack,
  onSelectVideoQuality,
  onSelectChapter,
  onSaveMetadata,
  onPlay
}: {
  disc: DiscInspection;
  pendingTitle: number | "auto" | null;
  selectedTitle: number | undefined;
  selectedAudioTrack: number | undefined;
  selectedSubtitleTrack: number | null;
  selectedVideoQuality: VideoQualityProfile;
  selectedChapter: number | null;
  onSelectTitle: (title: number) => void;
  onSelectAudioTrack: (track: number | undefined) => void;
  onSelectSubtitleTrack: (track: number | null) => void;
  onSelectVideoQuality: (quality: VideoQualityProfile) => void;
  onSelectChapter: (chapter: number | null) => void;
  onSaveMetadata: (titles: DvdMetadataTitleInput[]) => Promise<void>;
  onPlay: (options: DvdPlaybackOptions) => void;
}) {
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [chapterEditorOpen, setChapterEditorOpen] = useState(false);
  const [chapterDrafts, setChapterDrafts] = useState<Record<number, string>>({});
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  if (disc.type !== "dvd-video") {
    return null;
  }

  const titles = disc.dvdVideo?.titles ?? [];
  if (titles.length === 0) {
    return (
      <div className="cd-track-empty">
        <Video size={16} />
        <span>Title list unavailable. Play DVD starts the likely main title.</span>
      </div>
    );
  }

  const activeTitle = titles.find((title) => title.id === selectedTitle) ?? titles[0];
  const audioTracks = activeTitle?.audioTracks ?? [];
  const subtitleTracks = activeTitle?.subtitleTracks ?? [];
  const chapters = activeTitle?.chapters ?? [];
  const activeChapter = chapters.find((chapter) => chapter.number === selectedChapter);
  const isStarting = pendingTitle === activeTitle?.id;
  const activeTitleLabel = activeTitle
    ? activeTitle.id === disc.dvdVideo?.mainTitleId
      ? `Title ${activeTitle.id} - main`
      : `Title ${activeTitle.id}`
    : "DVD title";
  const openChapterEditor = () => {
    setChapterDrafts(Object.fromEntries(chapters.map((chapter) => [chapter.number, chapter.title ?? ""])));
    setMetadataError(null);
    setChapterEditorOpen(true);
  };
  const saveChapterNames = async () => {
    if (!activeTitle) {
      return;
    }

    try {
      setMetadataSaving(true);
      setMetadataError(null);
      await onSaveMetadata([
        {
          id: activeTitle.id,
          chapters: chapters.map((chapter) => ({
            number: chapter.number,
            title: chapterDrafts[chapter.number]?.trim() || undefined
          }))
        }
      ]);
      setChapterEditorOpen(false);
    } catch (error) {
      setMetadataError(error instanceof Error ? error.message : "Chapter names could not be saved.");
    } finally {
      setMetadataSaving(false);
    }
  };

  return (
    <div className="dvd-menu" aria-label="DVD menu">
      <div className="dvd-menu-header">
        <div className="dvd-menu-copy">
          <span className="eyebrow">DVD menu</span>
          <h3>{activeTitleLabel}</h3>
          <p>{activeTitle ? formatDvdTitleMeta(activeTitle) || "No detailed title scan available." : "No detailed title scan available."}</p>
        </div>
        <button
          className="action-button dvd-menu-play"
          type="button"
          onClick={() => {
            onPlay({
              title: activeTitle?.id,
              chapter: activeChapter?.number ?? null,
              startSeconds: activeChapter?.startSeconds,
              audioTrack: selectedAudioTrack,
              subtitleTrack: selectedSubtitleTrack,
              videoQuality: selectedVideoQuality
            });
          }}
          disabled={!activeTitle || pendingTitle !== null}
        >
          {isStarting ? <span className="button-spinner" aria-hidden="true" /> : <Play size={18} />}
          <span>{isStarting ? "Starting" : activeChapter ? `Play chapter ${activeChapter.number}` : "Play title"}</span>
        </button>
      </div>

      <div className="dvd-controls" aria-label="DVD playback options">
        <label className="dvd-option">
          <span>Title</span>
          <select
            value={activeTitle?.id ?? ""}
            onChange={(event) => {
              const title = Number(event.currentTarget.value);
              if (Number.isFinite(title)) {
                setChaptersOpen(false);
                setChapterEditorOpen(false);
                setMetadataError(null);
                onSelectTitle(title);
              }
            }}
            disabled={pendingTitle !== null}
          >
            {titles.map((title) => (
              <option value={title.id} key={title.id}>
                {title.id === disc.dvdVideo?.mainTitleId ? `Title ${title.id} main` : `Title ${title.id}`}
              </option>
            ))}
          </select>
        </label>

        <label className="dvd-option">
          <span>Audio</span>
          <select
            value={selectedAudioTrack ?? ""}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onSelectAudioTrack(value ? Number(value) : undefined);
            }}
            disabled={pendingTitle !== null || audioTracks.length === 0}
          >
            <option value="">Default</option>
            {audioTracks.map((track, index) => (
              <option value={track.id} key={track.id}>
                {formatAudioTrackLabel(track, index)}
              </option>
            ))}
          </select>
        </label>

        <label className="dvd-option">
          <span>Subtitles</span>
          <select
            value={selectedSubtitleTrack ?? "off"}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onSelectSubtitleTrack(value === "off" ? null : Number(value));
            }}
            disabled={pendingTitle !== null || subtitleTracks.length === 0}
          >
            <option value="off">Off</option>
            {subtitleTracks.map((track, index) => (
              <option value={track.id} key={track.id}>
                {formatSubtitleTrackLabel(track, index)}
              </option>
            ))}
          </select>
        </label>

        <label className="dvd-option">
          <span>Quality</span>
          <select
            value={selectedVideoQuality}
            onChange={(event) => {
              onSelectVideoQuality(event.currentTarget.value as VideoQualityProfile);
            }}
            disabled={pendingTitle !== null}
          >
            <option value="fast">Fast start</option>
            <option value="balanced">Balanced</option>
            <option value="quality">Best image</option>
          </select>
        </label>
      </div>

      {chapters.length ? (
        <div className={`dvd-chapters ${chaptersOpen ? "is-open" : ""}`} aria-label="DVD chapters">
          <div className="dvd-submenu-head">
            <button
              className="dvd-submenu-toggle"
              type="button"
              onClick={() => {
                setChaptersOpen((current) => {
                  if (current) {
                    setChapterEditorOpen(false);
                    setMetadataError(null);
                  }
                  return !current;
                });
              }}
              aria-expanded={chaptersOpen}
              disabled={pendingTitle !== null || metadataSaving}
            >
              <span>
                <span className="dvd-submenu-label">Chapters</span>
                <strong>{activeChapter ? formatChapterDisplayName(activeChapter) : `${chapters.length} chapters`}</strong>
              </span>
              <ChevronUp className="dvd-submenu-chevron" size={16} />
            </button>
          </div>
          {chaptersOpen ? (
            <div className="dvd-submenu-body">
              <div className="dvd-section-actions">
                <strong>{activeChapter ? formatChapterDisplayName(activeChapter) : "Full title"}</strong>
                <button
                  className="mini-action"
                  type="button"
                  onClick={() => {
                    if (chapterEditorOpen) {
                      setChapterEditorOpen(false);
                      setMetadataError(null);
                      return;
                    }

                    openChapterEditor();
                  }}
                  disabled={pendingTitle !== null || metadataSaving}
                >
                  {chapterEditorOpen ? <X size={14} /> : <Pencil size={14} />}
                  <span>{chapterEditorOpen ? "Close" : "Edit names"}</span>
                </button>
              </div>
              <div className="dvd-chapter-grid">
                <button
                  className={`dvd-chapter-chip ${selectedChapter === null ? "is-selected" : ""}`}
                  type="button"
                  onClick={() => onSelectChapter(null)}
                  disabled={pendingTitle !== null}
                  aria-pressed={selectedChapter === null}
                >
                  <span>Start</span>
                </button>
                {chapters.map((chapter) => (
                  <button
                    className={`dvd-chapter-chip ${selectedChapter === chapter.number ? "is-selected" : ""}`}
                    type="button"
                    key={chapter.number}
                    onClick={() => onSelectChapter(chapter.number)}
                    disabled={pendingTitle !== null || chapter.startSeconds === undefined}
                    aria-pressed={selectedChapter === chapter.number}
                    title={formatChapterTooltip(chapter)}
                  >
                    <span>{formatChapterChipTitle(chapter)}</span>
                    {formatChapterMeta(chapter) ? <small>{formatChapterMeta(chapter)}</small> : null}
                  </button>
                ))}
              </div>
              {chapterEditorOpen ? (
                <div className="dvd-chapter-editor" aria-label="DVD chapter name editor">
                  <div className="dvd-chapter-editor-list">
                    {chapters.map((chapter) => (
                      <label className="dvd-chapter-name-row" key={chapter.number}>
                        <span>{chapter.number.toString().padStart(2, "0")}</span>
                        <input
                          type="text"
                          value={chapterDrafts[chapter.number] ?? ""}
                          onChange={(event) => {
                            setChapterDrafts((current) => ({
                              ...current,
                              [chapter.number]: event.currentTarget.value
                            }));
                          }}
                          placeholder={`Chapter ${chapter.number}`}
                          disabled={metadataSaving}
                        />
                      </label>
                    ))}
                  </div>
                  {metadataError ? <p className="metadata-error">{metadataError}</p> : null}
                  <div className="metadata-actions">
                    <button
                      className="action-button secondary"
                      type="button"
                      onClick={() => {
                        setChapterEditorOpen(false);
                        setMetadataError(null);
                      }}
                      disabled={metadataSaving}
                    >
                      <X size={16} />
                      <span>Cancel</span>
                    </button>
                    <button className="action-button" type="button" onClick={saveChapterNames} disabled={metadataSaving}>
                      {metadataSaving ? <span className="button-spinner" aria-hidden="true" /> : <Save size={16} />}
                      <span>{metadataSaving ? "Saving" : "Save names"}</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="dvd-title-list" aria-label="DVD titles">
        {titles.map((title) => {
          const isMainTitle = title.id === disc.dvdVideo?.mainTitleId;
          const isSelected = activeTitle?.id === title.id;
          return (
            <button
              className={`dvd-title-row ${isSelected ? "is-selected" : ""}`}
              type="button"
              key={title.id}
              onClick={() => {
                if (!isSelected) {
                  setChaptersOpen(false);
                  setChapterEditorOpen(false);
                  setMetadataError(null);
                  onSelectTitle(title.id);
                }
              }}
              disabled={pendingTitle !== null}
              aria-pressed={isSelected}
              aria-label={`Select DVD title ${title.id}`}
              title={`Title ${title.id}`}
            >
              <span className="track-number">{title.id.toString().padStart(2, "0")}</span>
              <span className="dvd-title-copy">
                <span className="track-title">{isMainTitle ? `Title ${title.id} - main` : `Title ${title.id}`}</span>
                <span className="title-detail">{formatDvdTitleMeta(title)}</span>
              </span>
              <span className="dvd-title-state">{isSelected ? <Check size={15} /> : null}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AudioCdTracks({
  disc,
  pendingTrack,
  activeTrack,
  resumeEntry,
  metadataLoading,
  metadataCandidates,
  onPlay,
  onLookupMetadata,
  onResume,
  onSaveMetadata
}: {
  disc: DiscInspection;
  pendingTrack: number | null;
  activeTrack: number | null;
  resumeEntry?: PlaybackResumeEntry;
  metadataLoading: boolean;
  metadataCandidates: AudioCdMetadataInput[];
  onPlay: (track: number) => void;
  onLookupMetadata: () => void;
  onResume: (track: number, startSeconds: number) => void;
  onSaveMetadata: (metadata: AudioCdMetadataInput) => Promise<void>;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftAlbumTitle, setDraftAlbumTitle] = useState("");
  const [draftAlbumArtist, setDraftAlbumArtist] = useState("");
  const [draftCoverUrl, setDraftCoverUrl] = useState("");
  const [draftTracks, setDraftTracks] = useState<Record<number, { title: string; artist: string }>>({});
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  if (disc.type !== "audio-cd") {
    return null;
  }

  const tracks = disc.audioCd?.tracks ?? [];
  const albumTitle = disc.audioCd?.albumTitle;
  const albumArtist = disc.audioCd?.albumArtist;
  const metadataSource = disc.audioCd?.metadataSource;
  const metadataLabel =
    metadataSource === "musicbrainz" ? "MusicBrainz" : metadataSource === "cache" ? "Cached names" : "Track names";
  const coverUrl = disc.audioCd?.coverUrl;
  const openEditor = () => {
    setDraftAlbumTitle(albumTitle ?? "");
    setDraftAlbumArtist(albumArtist ?? "");
    setDraftCoverUrl(coverUrl ?? "");
    setDraftTracks(
      Object.fromEntries(
        tracks.map((track) => [
          track.number,
          {
            title: track.title ?? "",
            artist: track.artist ?? ""
          }
        ])
      )
    );
    setMetadataError(null);
    setEditorOpen(true);
  };
  const saveManualMetadata = async () => {
    try {
      setMetadataSaving(true);
      setMetadataError(null);
      await onSaveMetadata({
        albumTitle: draftAlbumTitle.trim() || undefined,
        albumArtist: draftAlbumArtist.trim() || undefined,
        coverUrl: draftCoverUrl.trim() || undefined,
        tracks: tracks.map((track) => ({
          number: track.number,
          title: draftTracks[track.number]?.title.trim() || undefined,
          artist: draftTracks[track.number]?.artist.trim() || undefined
        })),
        source: "manual"
      });
      setEditorOpen(false);
    } catch (error) {
      setMetadataError(error instanceof Error ? error.message : "Audio CD metadata could not be saved.");
    } finally {
      setMetadataSaving(false);
    }
  };
  const useCandidate = async (candidate: AudioCdMetadataInput) => {
    try {
      setMetadataSaving(true);
      setMetadataError(null);
      await onSaveMetadata({
        ...candidate,
        source: "musicbrainz"
      });
    } catch (error) {
      setMetadataError(error instanceof Error ? error.message : "Audio CD metadata candidate could not be saved.");
    } finally {
      setMetadataSaving(false);
    }
  };
  if (tracks.length === 0) {
    return (
      <div className="cd-track-empty">
        <AudioLines size={16} />
        <span>Track list unavailable. Play CD starts track 1.</span>
      </div>
    );
  }

  return (
    <div className="cd-panel">
      <div className="cd-panel-header">
        <div className="cd-panel-album">
          {coverUrl ? <img className="cd-cover" src={coverUrl} alt="" loading="lazy" /> : null}
          <div className="cd-panel-copy">
            <strong>{albumTitle ?? "Audio CD"}</strong>
            <span>{albumArtist ?? metadataLabel}</span>
          </div>
        </div>
        <div className="cd-panel-actions">
          {resumeEntry ? (
            <button
              className="mini-action"
              type="button"
              onClick={() => {
                const track = resumeEntryKeyTrack(resumeEntry.key);
                if (track) {
                  onResume(track, resumeEntry.positionSeconds);
                }
              }}
              disabled={pendingTrack !== null}
              title={`Resume at ${formatPlaybackTime(resumeEntry.positionSeconds)}`}
            >
              <RefreshCcw size={14} />
              <span>Resume</span>
            </button>
          ) : null}
          <button className="mini-action" type="button" onClick={onLookupMetadata} disabled={metadataLoading || pendingTrack !== null}>
            {metadataLoading ? <span className="button-spinner small" aria-hidden="true" /> : <RefreshCcw size={14} />}
            <span>{metadataLoading ? "Searching" : "Find names"}</span>
          </button>
          <button
            className="mini-action"
            type="button"
            onClick={() => {
              if (editorOpen) {
                setEditorOpen(false);
                setMetadataError(null);
                return;
              }

              openEditor();
            }}
            disabled={metadataSaving || pendingTrack !== null}
          >
            {editorOpen ? <X size={14} /> : <Pencil size={14} />}
            <span>{editorOpen ? "Close" : "Edit"}</span>
          </button>
        </div>
      </div>
      {metadataCandidates.length > 1 ? (
        <div className="metadata-candidates" aria-label="Audio CD metadata candidates">
          {metadataCandidates.slice(0, 4).map((candidate, index) => (
            <button
              className="metadata-candidate"
              type="button"
              key={candidate.musicBrainzReleaseId ?? `${candidate.albumTitle}:${index}`}
              onClick={() => {
                void useCandidate(candidate);
              }}
              disabled={metadataSaving || pendingTrack !== null}
              title={candidate.albumTitle ?? `Candidate ${index + 1}`}
            >
              {candidate.coverUrl ? <img src={candidate.coverUrl} alt="" loading="lazy" /> : <AudioLines size={18} />}
              <span>
                <strong>{candidate.albumTitle ?? `Candidate ${index + 1}`}</strong>
                <small>{[candidate.albumArtist, `${candidate.tracks.length} tracks`].filter(Boolean).join(" - ")}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {editorOpen ? (
        <div className="audio-cd-editor" aria-label="Audio CD metadata editor">
          <div className="audio-cd-editor-grid">
            <label>
              <span>Album</span>
              <input
                type="text"
                value={draftAlbumTitle}
                onChange={(event) => {
                  setDraftAlbumTitle(event.currentTarget.value);
                }}
                disabled={metadataSaving}
              />
            </label>
            <label>
              <span>Artist</span>
              <input
                type="text"
                value={draftAlbumArtist}
                onChange={(event) => {
                  setDraftAlbumArtist(event.currentTarget.value);
                }}
                disabled={metadataSaving}
              />
            </label>
            <label className="audio-cd-editor-wide">
              <span>Cover URL</span>
              <input
                type="url"
                value={draftCoverUrl}
                onChange={(event) => {
                  setDraftCoverUrl(event.currentTarget.value);
                }}
                disabled={metadataSaving}
              />
            </label>
          </div>
          <div className="audio-cd-track-editor">
            {tracks.map((track) => (
              <div className="audio-cd-track-edit-row" key={track.number}>
                <span>{track.number.toString().padStart(2, "0")}</span>
                <input
                  type="text"
                  value={draftTracks[track.number]?.title ?? ""}
                  onChange={(event) => {
                    setDraftTracks((current) => ({
                      ...current,
                      [track.number]: {
                        title: event.currentTarget.value,
                        artist: current[track.number]?.artist ?? ""
                      }
                    }));
                  }}
                  placeholder={`Track ${track.number}`}
                  disabled={metadataSaving}
                />
                <input
                  type="text"
                  value={draftTracks[track.number]?.artist ?? ""}
                  onChange={(event) => {
                    setDraftTracks((current) => ({
                      ...current,
                      [track.number]: {
                        title: current[track.number]?.title ?? "",
                        artist: event.currentTarget.value
                      }
                    }));
                  }}
                  placeholder="Artist"
                  disabled={metadataSaving}
                />
              </div>
            ))}
          </div>
          {metadataError ? <p className="metadata-error">{metadataError}</p> : null}
          <div className="metadata-actions">
            <button
              className="action-button secondary"
              type="button"
              onClick={() => {
                setEditorOpen(false);
                setMetadataError(null);
              }}
              disabled={metadataSaving}
            >
              <X size={16} />
              <span>Cancel</span>
            </button>
            <button className="action-button" type="button" onClick={saveManualMetadata} disabled={metadataSaving}>
              {metadataSaving ? <span className="button-spinner" aria-hidden="true" /> : <Save size={16} />}
              <span>{metadataSaving ? "Saving" : "Save"}</span>
            </button>
          </div>
        </div>
      ) : null}
      <div className="cd-track-list" aria-label="Audio CD tracks">
        {tracks.map((track) => (
          <button
            className={`cd-track-row ${activeTrack === track.number ? "is-selected" : ""}`}
            type="button"
            key={track.number}
            onClick={() => {
              onPlay(track.number);
            }}
            disabled={pendingTrack !== null}
            aria-label={`Play track ${track.number}`}
            title={track.title ?? `Track ${track.number}`}
          >
            <span className="track-number">{track.number.toString().padStart(2, "0")}</span>
            <span className="track-title">{track.title ?? `Track ${track.number}`}</span>
            <span className="track-duration">{formatDuration(track.durationSeconds) ?? ""}</span>
            {pendingTrack === track.number ? <span className="button-spinner small" aria-hidden="true" /> : <Play size={16} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function FolderBrowser({
  listing,
  loading,
  adding,
  onNavigate,
  onAdd,
  onClose
}: {
  listing: LocalMediaFolderBrowserResponse | null;
  loading: boolean;
  adding: boolean;
  onNavigate: (path: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  return (
    <div className="folder-browser" aria-busy={loading}>
      <div className="folder-browser-header">
        <div>
          <span className="eyebrow">Server folders</span>
          <h3>{listing ? pathLabel(listing.currentPath) : "Loading"}</h3>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close folder browser" title="Close">
          <X size={18} />
        </button>
      </div>

      {listing ? (
        <>
          <div className="folder-path" title={listing.currentPath}>
            {listing.currentPath}
          </div>

          <div className="folder-roots" aria-label="Available server roots">
            {listing.roots.map((root) => (
              <button
                className="folder-root-button"
                type="button"
                key={root.path}
                onClick={() => {
                  onNavigate(root.path);
                }}
                disabled={loading || root.path === listing.currentPath}
              >
                {root.displayName}
              </button>
            ))}
          </div>

          <div className="folder-list">
            {listing.parentPath ? (
              <button
                className="folder-row"
                type="button"
                onClick={() => {
                  onNavigate(listing.parentPath!);
                }}
                disabled={loading}
              >
                <ChevronUp size={18} />
                <span>Up</span>
              </button>
            ) : null}

            {listing.directories.map((directory) => (
              <button
                className="folder-row"
                type="button"
                key={directory.path}
                onClick={() => {
                  onNavigate(directory.path);
                }}
                disabled={loading}
              >
                <Folder size={18} />
                <span>{directory.name}</span>
              </button>
            ))}
          </div>

          <div className="folder-footer">
            <button className="action-button" type="button" onClick={onAdd} disabled={loading || adding}>
              {adding ? <span className="button-spinner" aria-hidden="true" /> : <Check size={18} />}
              <span>Add this folder</span>
            </button>
          </div>
        </>
      ) : (
        <div className="folder-loading">
          <span className="button-spinner" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

function PlayerPanel({
  session,
  audioCdTracks,
  pendingAudioCdTrack,
  playbackKey,
  playbackLabel,
  onPlaybackProgress,
  onPlayAudioCdTrack,
  onStop
}: {
  session: PlaybackSession | null;
  audioCdTracks: NonNullable<DiscInspection["audioCd"]>["tracks"];
  pendingAudioCdTrack: number | null;
  playbackKey: string | null;
  playbackLabel?: string;
  onPlaybackProgress: (entry: PlaybackResumeEntry) => void;
  onPlayAudioCdTrack: (track: number) => void;
  onStop: () => Promise<void>;
}) {
  const isAudio = session?.mediaType === "local-audio" || session?.mediaType === "audio-cd";
  const isAudioCd = session?.mediaType === "audio-cd";
  const isVideo = session?.mediaType === "local-video" || session?.mediaType === "dvd-video" || session?.mediaType === "local-dvd-video";
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackPaused, setPlaybackPaused] = useState(true);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [playbackReloadNonce, setPlaybackReloadNonce] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const lastProgressSaveRef = useRef<{ key: string | null; positionSeconds: number }>({
    key: null,
    positionSeconds: 0
  });
  const sortedAudioCdTracks = [...audioCdTracks].sort((left, right) => left.number - right.number);
  const currentAudioCdTrack = isAudioCd && session?.track ? sortedAudioCdTracks.find((track) => track.number === session.track) : undefined;
  const currentAudioCdTrackIndex = currentAudioCdTrack
    ? sortedAudioCdTracks.findIndex((track) => track.number === currentAudioCdTrack.number)
    : -1;
  const previousAudioCdTrack = currentAudioCdTrackIndex > 0 ? sortedAudioCdTracks[currentAudioCdTrackIndex - 1] : undefined;
  const nextAudioCdTrack =
    currentAudioCdTrackIndex >= 0 && currentAudioCdTrackIndex < sortedAudioCdTracks.length - 1
      ? sortedAudioCdTracks[currentAudioCdTrackIndex + 1]
      : undefined;
  const effectivePlaybackDuration = playbackDuration || currentAudioCdTrack?.durationSeconds || 0;
  const playbackProgress = effectivePlaybackDuration > 0 ? Math.min(100, Math.max(0, (playbackTime / effectivePlaybackDuration) * 100)) : 0;
  const serverOffsetSeconds = session?.streamUrl?.endsWith(".m3u8") ? (session.startSeconds ?? 0) : 0;

  useEffect(() => {
    setPlaybackError(null);
    setPlaybackPaused(true);
    setPlaybackTime(0);
    setPlaybackDuration(0);
    lastProgressSaveRef.current = {
      key: playbackKey,
      positionSeconds: 0
    };
  }, [playbackKey, session?.sessionId]);

  useEffect(() => {
    const media = isAudio ? audioRef.current : isVideo ? videoRef.current : null;
    if (!media) {
      return;
    }

    const clearPlaybackError = () => {
      setPlaybackError(null);
    };

    const syncPlaybackState = () => {
      const currentTime = Number.isFinite(media.currentTime) ? media.currentTime : 0;
      const duration = Number.isFinite(media.duration) ? media.duration : 0;
      setPlaybackPaused(media.paused);
      setPlaybackTime(currentTime);
      setPlaybackDuration(duration);

      const absolutePosition = serverOffsetSeconds + currentTime;
      const absoluteDuration = duration ? serverOffsetSeconds + duration : currentAudioCdTrack?.durationSeconds;
      const lastSaved = lastProgressSaveRef.current;
      if (
        playbackKey &&
        session?.streamUrl &&
        session?.mediaType &&
        (lastSaved.key !== playbackKey || Math.abs(absolutePosition - lastSaved.positionSeconds) >= 5 || media.ended)
      ) {
        lastProgressSaveRef.current = {
          key: playbackKey,
          positionSeconds: absolutePosition
        };
        onPlaybackProgress({
          key: playbackKey,
          label: playbackLabel ?? session.displayName ?? "Playback",
          mediaType: session.mediaType,
          positionSeconds: absolutePosition,
          durationSeconds: absoluteDuration,
          updatedAt: new Date().toISOString()
        });
      }
    };

    media.addEventListener("play", syncPlaybackState);
    media.addEventListener("pause", syncPlaybackState);
    media.addEventListener("timeupdate", syncPlaybackState);
    media.addEventListener("loadedmetadata", syncPlaybackState);
    media.addEventListener("durationchange", syncPlaybackState);
    media.addEventListener("ended", syncPlaybackState);
    media.addEventListener("canplay", clearPlaybackError);
    media.addEventListener("playing", clearPlaybackError);
    syncPlaybackState();

    return () => {
      media.removeEventListener("play", syncPlaybackState);
      media.removeEventListener("pause", syncPlaybackState);
      media.removeEventListener("timeupdate", syncPlaybackState);
      media.removeEventListener("loadedmetadata", syncPlaybackState);
      media.removeEventListener("durationchange", syncPlaybackState);
      media.removeEventListener("ended", syncPlaybackState);
      media.removeEventListener("canplay", clearPlaybackError);
      media.removeEventListener("playing", clearPlaybackError);
    };
  }, [
    currentAudioCdTrack?.durationSeconds,
    isAudio,
    isVideo,
    onPlaybackProgress,
    playbackKey,
    playbackLabel,
    serverOffsetSeconds,
    session?.displayName,
    session?.mediaType,
    session?.sessionId,
    session?.streamUrl
  ]);

  const togglePlayback = () => {
    const media = isAudio ? audioRef.current : isVideo ? videoRef.current : null;
    if (!media) {
      return;
    }

    if (media.paused) {
      void media.play().catch(() => {
        setPlaybackError(isAudio ? "The audio stream is ready. Try again to start playback." : "The video stream is ready. Try again to start playback.");
      });
      return;
    }

    media.pause();
  };

  const retryPlayback = () => {
    setPlaybackError(null);
    setPlaybackReloadNonce((current) => current + 1);
  };

  const seekPlayback = (nextTime: number) => {
    const media = isAudio ? audioRef.current : isVideo ? videoRef.current : null;
    if (!media) {
      return;
    }

    try {
      media.currentTime = Math.min(Math.max(0, nextTime), effectivePlaybackDuration || nextTime);
      setPlaybackTime(media.currentTime);
    } catch {
      setPlaybackError("This stream cannot seek in the current browser.");
    }
  };

  const playPreviousAudioCdTrack = () => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      seekPlayback(0);
      return;
    }

    if (previousAudioCdTrack) {
      onPlayAudioCdTrack(previousAudioCdTrack.number);
    }
  };

  const setMediaVolume = (nextVolume: number) => {
    const normalizedVolume = Math.min(1, Math.max(0, nextVolume));
    setVolume(normalizedVolume);
    setMuted(normalizedVolume === 0);
  };

  const toggleMuted = () => {
    setMuted((current) => !current);
  };

  useEffect(() => {
    const media = isAudio ? audioRef.current : isVideo ? videoRef.current : null;
    if (!media) {
      return;
    }

    media.volume = volume;
    media.muted = muted;
  }, [isAudio, isVideo, muted, session?.streamUrl, volume]);

  useEffect(() => {
    const media = isAudio ? audioRef.current : isVideo ? videoRef.current : null;
    const startSeconds = session?.startSeconds ?? 0;
    if (!media || !session?.streamUrl || session.streamUrl.endsWith(".m3u8") || startSeconds <= 0) {
      return;
    }

    let applied = false;
    const applyInitialSeek = () => {
      if (applied) {
        return;
      }

      const maxTime = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : startSeconds;
      try {
        media.currentTime = Math.min(startSeconds, maxTime);
        setPlaybackTime(media.currentTime);
        applied = true;
      } catch {
        applied = true;
      }
    };

    media.addEventListener("loadedmetadata", applyInitialSeek);
    media.addEventListener("canplay", applyInitialSeek);
    if (media.readyState >= 1) {
      applyInitialSeek();
    }

    return () => {
      media.removeEventListener("loadedmetadata", applyInitialSeek);
      media.removeEventListener("canplay", applyInitialSeek);
    };
  }, [isAudio, isVideo, session?.sessionId, session?.startSeconds, session?.streamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isAudio || !session?.streamUrl) {
      return;
    }
    const streamUrl = session.streamUrl;

    let disposed = false;
    let hlsInstance: Hls | null = null;
    const requestPlayback = () => {
      setPlaybackError(null);
      void audio.play().catch(() => {
        setPlaybackError(isAudioCd ? "The stream is ready. Press Play in DiscStream to start it." : "The stream is ready. Press play in the audio controls to start it.");
      });
    };

    if (streamUrl.endsWith(".m3u8")) {
      const loadNativeHls = () => {
        audio.src = streamUrl;
        audio.addEventListener("loadedmetadata", requestPlayback, { once: true });
      };

      void import("hls.js")
        .then(({ default: Hls }) => {
          if (disposed) {
            return;
          }

          if (!Hls.isSupported()) {
            if (audio.canPlayType("application/vnd.apple.mpegurl")) {
              loadNativeHls();
            } else {
              setPlaybackError("This browser cannot play HLS audio streams.");
            }
            return;
          }

          hlsInstance = new Hls();
          hlsInstance.on(Hls.Events.MANIFEST_PARSED, requestPlayback);
          hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
            if (hlsInstance) {
              handleHlsPlaybackError(hlsInstance, Hls, data, "audio", setPlaybackError);
            }
          });
          hlsInstance.loadSource(streamUrl);
          hlsInstance.attachMedia(audio);
        })
        .catch(() => {
          if (disposed) {
            return;
          }

          if (audio.canPlayType("application/vnd.apple.mpegurl")) {
            loadNativeHls();
            return;
          }

          setPlaybackError("HLS audio playback could not be loaded.");
        });

      return () => {
        disposed = true;
        hlsInstance?.destroy();
        audio.removeEventListener("loadedmetadata", requestPlayback);
        audio.removeAttribute("src");
        audio.load();
      };
    }

    audio.src = streamUrl;
    audio.addEventListener("canplay", requestPlayback, { once: true });
    return () => {
      audio.removeEventListener("canplay", requestPlayback);
      audio.removeAttribute("src");
      audio.load();
    };
  }, [isAudio, isAudioCd, playbackReloadNonce, session?.streamUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideo || !session?.streamUrl) {
      return;
    }
    const streamUrl = session.streamUrl;

    let disposed = false;
    let hlsInstance: Hls | null = null;
    const requestPlayback = () => {
      setPlaybackError(null);
      void video.play().catch(() => {
        setPlaybackError("The stream is ready. Press play in the video controls to start it.");
      });
    };

    if (streamUrl.endsWith(".m3u8")) {
      const loadNativeHls = () => {
        video.src = streamUrl;
        video.addEventListener("loadedmetadata", requestPlayback, { once: true });
      };

      void import("hls.js")
        .then(({ default: Hls }) => {
          if (disposed) {
            return;
          }

          if (!Hls.isSupported()) {
            if (video.canPlayType("application/vnd.apple.mpegurl")) {
              loadNativeHls();
            } else {
              setPlaybackError("This browser cannot play HLS video streams.");
            }
            return;
          }

          hlsInstance = new Hls();
          hlsInstance.on(Hls.Events.MANIFEST_PARSED, requestPlayback);
          hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
            if (hlsInstance) {
              handleHlsPlaybackError(hlsInstance, Hls, data, "video", setPlaybackError);
            }
          });
          hlsInstance.loadSource(streamUrl);
          hlsInstance.attachMedia(video);
        })
        .catch(() => {
          if (disposed) {
            return;
          }

          if (video.canPlayType("application/vnd.apple.mpegurl")) {
            loadNativeHls();
            return;
          }

          setPlaybackError("HLS video playback could not be loaded.");
        });

      return () => {
        disposed = true;
        hlsInstance?.destroy();
        video.removeEventListener("loadedmetadata", requestPlayback);
        video.removeAttribute("src");
        video.load();
      };
    }

    video.src = streamUrl;
    video.addEventListener("loadedmetadata", requestPlayback, { once: true });
    return () => {
      video.removeEventListener("loadedmetadata", requestPlayback);
      video.removeAttribute("src");
      video.load();
    };
  }, [isVideo, playbackReloadNonce, session?.streamUrl]);

  return (
    <div className="player-panel">
      <div className="player-heading">
        <span className="eyebrow">Player</span>
        <h2>{session?.displayName ?? "Ready"}</h2>
        {session?.videoEncoder || session?.videoQuality ? (
          <p>{[session.videoEncoder ? videoEncoderLabel(session.videoEncoder) : undefined, session.videoQuality ? videoQualityLabel(session.videoQuality) : undefined].filter(Boolean).join(" - ")}</p>
        ) : null}
      </div>

      {session?.streamUrl && isAudio ? (
        <audio
          className={`media-player ${isAudioCd ? "is-hidden" : ""}`}
          ref={audioRef}
          controls={!isAudioCd}
          autoPlay
          onEnded={() => {
            setPlaybackPaused(true);
            if (isAudioCd && nextAudioCdTrack) {
              onPlayAudioCdTrack(nextAudioCdTrack.number);
            }
          }}
          onError={() => {
            setPlaybackError((current) => current ?? describeMediaElementError(audioRef.current, "The browser could not play this audio stream."));
          }}
        />
      ) : null}
      {session?.streamUrl && isVideo ? (
        <video
          className="video-player"
          ref={videoRef}
          controls
          autoPlay
          onError={() => {
            setPlaybackError((current) => current ?? describeMediaElementError(videoRef.current, "The browser could not play this video stream."));
          }}
        />
      ) : null}
      {session?.streamUrl && isAudioCd ? (
        <div className="cd-player-display">
          <div className="cd-player-meta">
            <span className="track-number">{session.track ? session.track.toString().padStart(2, "0") : "--"}</span>
            <div>
              <strong>{currentAudioCdTrack?.title ?? session.displayName ?? "Audio CD"}</strong>
              <span>{currentAudioCdTrack?.artist ?? "Audio CD"}</span>
            </div>
            <span className="track-duration">{formatPlaybackProgress(playbackTime, effectivePlaybackDuration)}</span>
          </div>
          <div className="playback-progress">
            <span style={{ width: `${playbackProgress}%` }} />
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.round(effectivePlaybackDuration))}
              step={1}
              value={Math.min(Math.round(playbackTime), Math.max(1, Math.round(effectivePlaybackDuration)))}
              onChange={(event) => {
                seekPlayback(Number(event.currentTarget.value));
              }}
              aria-label="Seek audio track"
              disabled={!effectivePlaybackDuration}
            />
          </div>
          <div className="cd-player-volume">
            <button
              className="icon-button compact"
              type="button"
              onClick={toggleMuted}
              disabled={!session?.streamUrl}
              aria-label={muted ? "Unmute" : "Mute"}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(event) => {
                setMediaVolume(Number(event.currentTarget.value));
              }}
              aria-label="Volume"
            />
          </div>
        </div>
      ) : null}
      {playbackError ? (
        <div className="playback-warning" role="status">
          <CircleAlert size={16} />
          <span>{playbackError}</span>
          {session?.streamUrl ? (
            <button type="button" onClick={retryPlayback}>
              <RefreshCcw size={14} />
              <span>Retry</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {!session?.streamUrl ? (
        <div className="transport-idle">
          <MonitorPlay size={32} />
          <p>Load a disc, track, or movie to start playback.</p>
        </div>
      ) : null}

      <div className={`transport ${isAudioCd ? "cd-transport" : ""}`}>
        {isAudioCd ? (
          <button
            className="icon-button"
            type="button"
            onClick={playPreviousAudioCdTrack}
            disabled={(!previousAudioCdTrack && playbackTime <= 3) || pendingAudioCdTrack !== null}
            aria-label="Previous track"
            title="Previous track"
          >
            <SkipBack size={18} />
          </button>
        ) : null}
        <button
          className="icon-button"
          type="button"
          onClick={togglePlayback}
          disabled={!session?.streamUrl}
          aria-label={playbackPaused ? "Play" : "Pause"}
          title={playbackPaused ? "Play" : "Pause"}
        >
          {playbackPaused ? <Play size={18} /> : <Pause size={18} />}
        </button>
        {isAudioCd ? (
          <button
            className="icon-button"
            type="button"
            onClick={() => {
              if (nextAudioCdTrack) {
                onPlayAudioCdTrack(nextAudioCdTrack.number);
              }
            }}
            disabled={!nextAudioCdTrack || pendingAudioCdTrack !== null}
            aria-label="Next track"
            title="Next track"
          >
            <SkipForward size={18} />
          </button>
        ) : null}
        <button className="icon-button danger" type="button" onClick={onStop} disabled={!session?.streamUrl} aria-label="Stop" title="Stop">
          <Square size={18} />
        </button>
      </div>
    </div>
  );
}

function handleHlsPlaybackError(
  hls: Hls,
  HlsCtor: HlsConstructor,
  data: HlsErrorData,
  mediaKind: "audio" | "video",
  setPlaybackError: (message: string | null) => void
): void {
  if (!data.fatal) {
    return;
  }

  if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
    setPlaybackError(`The ${mediaKind} stream connection was interrupted. Retrying...`);
    hls.startLoad();
    return;
  }

  if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
    setPlaybackError(`The ${mediaKind} stream stalled while decoding. Recovering...`);
    hls.recoverMediaError();
    return;
  }

  setPlaybackError(`HLS ${mediaKind} playback failed${data.details ? `: ${data.details}` : "."}`);
}

function describeMediaElementError(media: HTMLMediaElement | null, fallback: string): string {
  const code = media?.error?.code;
  if (!code) {
    return fallback;
  }

  const reason =
    code === MediaError.MEDIA_ERR_ABORTED
      ? "Playback was interrupted."
      : code === MediaError.MEDIA_ERR_NETWORK
        ? "The media file could not be loaded."
        : code === MediaError.MEDIA_ERR_DECODE
          ? "The browser could not decode this stream."
          : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? "The browser did not recognize this stream format."
            : null;

  return reason ? `${fallback} ${reason}` : fallback;
}

function videoEncoderLabel(encoder: string): string {
  switch (encoder) {
    case "h264_videotoolbox":
      return "VideoToolbox hardware encoding";
    case "h264_v4l2m2m":
      return "V4L2 hardware encoding";
    case "libx264":
      return "Software H.264 encoding";
    default:
      return encoder;
  }
}

function videoQualityLabel(quality: VideoQualityProfile): string {
  switch (quality) {
    case "fast":
      return "Fast start";
    case "quality":
      return "Best image";
    case "balanced":
      return "Balanced";
  }
}

function LocalMediaRow({
  item,
  pending,
  resumePosition,
  onResume,
  onPlay
}: {
  item: LocalMediaItem;
  pending: boolean;
  resumePosition?: number;
  onResume: () => void;
  onPlay: () => void;
}) {
  const isVideo = item.mediaType === "video-file" || item.mediaType === "dvd-video-folder";
  const needsTranscode = item.mediaType === "dvd-video-folder" || Boolean(item.videoFile?.transcodeRequired);
  const artworkUrl = item.artworkUrl ?? item.audioFile?.coverUrl ?? item.videoFile?.thumbnailUrl;

  return (
    <article className={`media-row ${resumePosition ? "has-resume" : ""}`}>
      <div className={`media-kind ${artworkUrl ? "has-artwork" : ""}`} aria-hidden="true">
        {artworkUrl ? <img src={artworkUrl} alt="" loading="lazy" /> : isVideo ? <Video size={20} /> : <AudioLines size={20} />}
      </div>
      <div className="media-copy">
        <h3>{item.audioFile?.title ?? item.videoFile?.title ?? item.displayName}</h3>
        <p>{mediaDetail(item)}</p>
      </div>
      {resumePosition ? (
        <button
          className="icon-button"
          type="button"
          onClick={onResume}
          disabled={pending}
          aria-label={`Resume ${item.displayName} at ${formatPlaybackTime(resumePosition)}`}
          title={`Resume at ${formatPlaybackTime(resumePosition)}`}
        >
          <RefreshCcw size={18} />
        </button>
      ) : null}
      <button
        className="icon-button"
        type="button"
        onClick={onPlay}
        disabled={pending}
        aria-label={`Play ${item.displayName}`}
        title={`Play ${item.displayName}`}
      >
        {pending ? <span className="button-spinner" aria-hidden="true" /> : needsTranscode ? <Wrench size={18} /> : <Play size={18} />}
      </button>
    </article>
  );
}

function DiagnosticsPanel({ diagnostics }: { diagnostics: DiagnosticsResponse }) {
  const commandsReady = Object.entries(diagnostics.capabilities.commands).filter(([, ready]) => ready).length;
  const encoderReady =
    diagnostics.capabilities.videoEncoders.libx264 ||
    diagnostics.capabilities.videoEncoders.h264VideoToolbox ||
    diagnostics.capabilities.videoEncoders.h264V4l2m2m;

  return (
    <div className="diagnostics-panel">
      <div className="diagnostics-grid">
        <div>
          <span className="eyebrow">Platform</span>
          <strong>{diagnostics.capabilities.platform}</strong>
          <p>{diagnostics.capabilities.architecture}</p>
        </div>
        <div>
          <span className="eyebrow">Commands</span>
          <strong>{commandsReady}</strong>
          <p>available</p>
        </div>
        <div>
          <span className="eyebrow">FFmpeg</span>
          <strong>{diagnostics.capabilities.commands.ffmpeg ? "Ready" : "Missing"}</strong>
          <p>{encoderReady ? "H.264 encoder found" : "Encoder missing"}</p>
        </div>
        <div>
          <span className="eyebrow">Local media</span>
          <strong>{diagnostics.localMedia.roots.length}</strong>
          <p>{diagnostics.localMedia.items.length} playable items</p>
        </div>
        <div>
          <span className="eyebrow">Stream cache</span>
          <strong>{formatFileSize(diagnostics.runtime.streamCache.totalBytes)}</strong>
          <p>{streamCacheDetail(diagnostics.runtime.streamCache)}</p>
        </div>
        <div>
          <span className="eyebrow">Logs</span>
          <strong>{diagnostics.runtime.logging.filePath ? "File" : "Console"}</strong>
          <p>{diagnostics.runtime.logging.level}</p>
        </div>
      </div>

      <div className="diagnostics-warnings">
        {diagnostics.warnings.length > 0 ? (
          diagnostics.warnings.map((warning) => (
            <article className={`diagnostic-warning severity-${warning.severity}`} key={`${warning.code}:${warning.message}`}>
              <CircleAlert size={16} aria-hidden="true" />
              <div>
                <strong>{warning.message}</strong>
                {warning.hint ? <p>{warning.hint}</p> : null}
              </div>
            </article>
          ))
        ) : (
          <article className="diagnostic-warning severity-info">
            <Check size={16} aria-hidden="true" />
            <div>
              <strong>No diagnostic warnings.</strong>
              <p>Core runtime checks look ready.</p>
            </div>
          </article>
        )}
      </div>

      <details className="diagnostics-details">
        <summary>Runtime folders</summary>
        <dl>
          {Object.entries(diagnostics.runtime.paths).map(([name, value]) => (
            <div key={name}>
              <dt>{runtimePathLabel(name)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function localMediaShelfCountLabel(total: number, filtered: number, displayed: number, scopedToFolder: boolean): string {
  if (scopedToFolder) {
    return `${displayed} in folder`;
  }

  if (filtered === total) {
    return `${total} playable`;
  }

  return `${filtered} of ${total}`;
}

function localMediaGroupSelectLabel(group: LocalMediaGroup): string {
  return group.directoryLabel === "Root" ? `${group.rootName} / Root` : `${group.rootName} / ${group.directoryLabel}`;
}

function localMediaGroupSummary(group: LocalMediaGroup): string[] {
  const audioCount = group.items.filter((item) => item.mediaType === "audio-file").length;
  const videoCount = group.items.filter((item) => item.mediaType === "video-file").length;
  const dvdCount = group.items.filter((item) => item.mediaType === "dvd-video-folder").length;
  const durationSeconds = group.items.reduce((total, item) => total + localMediaDuration(item), 0);

  return [
    `${group.items.length} ${group.items.length === 1 ? "item" : "items"}`,
    audioCount ? `${audioCount} audio` : undefined,
    videoCount ? `${videoCount} video` : undefined,
    dvdCount ? `${dvdCount} DVD` : undefined,
    formatDuration(durationSeconds)
  ].filter((item): item is string => Boolean(item));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function streamCacheDetail(streamCache: DiagnosticsResponse["runtime"]["streamCache"]): string {
  return [
    `${streamCache.directoryCount} folders`,
    streamCache.ffmpegLogCount ? `${streamCache.ffmpegLogCount} FFmpeg logs` : undefined
  ]
    .filter(Boolean)
    .join(" - ");
}

function runtimePathLabel(name: string): string {
  return name.replace(/Dir$/, "").replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}

function mediaDetail(item: LocalMediaItem): string {
  if (item.mediaType === "dvd-video-folder") {
    return ["DVD-Video folder", item.relativePath].join(" - ");
  }

  if (item.audioFile) {
    const albumLabel = [item.audioFile.albumArtist, item.audioFile.albumTitle].filter(Boolean).join(" - ");
    return [
      item.audioFile.artist,
      albumLabel || undefined,
      item.audioFile.trackNumber ? `Track ${item.audioFile.trackNumber}` : undefined,
      item.audioFile.format.toUpperCase(),
      item.audioFile.codec,
      formatDuration(item.audioFile.durationSeconds),
      item.audioFile.bitrateKbps ? `${item.audioFile.bitrateKbps} kbps` : undefined,
      item.relativePath
    ]
      .filter(Boolean)
      .join(" - ");
  }

  if (item.videoFile) {
    const mode = item.videoFile.transcodeRequired ? "needs HLS" : "direct";
    return [
      item.videoFile.container.toUpperCase(),
      item.videoFile.videoCodec,
      item.videoFile.audioCodec,
      formatResolution(item.videoFile.width, item.videoFile.height),
      formatDuration(item.videoFile.durationSeconds),
      mode,
      item.relativePath
    ]
      .filter(Boolean)
      .join(" - ");
  }

  return item.relativePath;
}

function localMediaFilterLabel(filter: LocalMediaFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
    case "dvd":
      return "DVD";
  }
}

function localMediaFilterMatches(item: LocalMediaItem, filter: LocalMediaFilter): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "audio") {
    return item.mediaType === "audio-file";
  }

  if (filter === "video") {
    return item.mediaType === "video-file";
  }

  return item.mediaType === "dvd-video-folder";
}

function groupLocalMediaItems(items: LocalMediaItem[], roots: AppSnapshot["localMedia"]["roots"]): LocalMediaGroup[] {
  const rootNames = new Map(roots.map((root) => [root.id, root.displayName]));
  const groups = new Map<string, LocalMediaGroup>();

  for (const item of items) {
    const rootName = rootNames.get(item.rootId) ?? "Local media";
    const directoryLabel = localMediaDirectoryLabel(item);
    const key = `${item.rootId}:${directoryLabel}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(key, {
      key,
      rootName,
      directoryLabel,
      items: [item]
    });
  }

  return [...groups.values()].sort((left, right) => {
    const rootDelta = left.rootName.localeCompare(right.rootName);
    return rootDelta || localMediaDirectoryRank(left.directoryLabel) - localMediaDirectoryRank(right.directoryLabel) || left.directoryLabel.localeCompare(right.directoryLabel);
  });
}

function localMediaDirectoryLabel(item: LocalMediaItem): string {
  const parts = item.relativePath.split(/[\\/]/).filter(Boolean);
  const directoryParts =
    item.mediaType === "dvd-video-folder" && parts.at(-1)?.toUpperCase() === "VIDEO_TS" ? parts.slice(0, -2) : parts.slice(0, -1);
  return directoryParts.length ? directoryParts.join("/") : "Root";
}

function localMediaDirectoryRank(label: string): number {
  return label === "Root" ? 0 : 1;
}

function localMediaSearchText(item: LocalMediaItem): string {
  return [
    item.displayName,
    item.relativePath,
    item.mediaType,
    item.mimeType,
    item.audioFile?.title,
    item.audioFile?.artist,
    item.audioFile?.albumTitle,
    item.audioFile?.albumArtist,
    item.audioFile?.trackNumber?.toString(),
    item.audioFile?.format,
    item.audioFile?.codec,
    item.videoFile?.title,
    item.videoFile?.container,
    item.videoFile?.videoCodec,
    item.videoFile?.audioCodec
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sortLocalMediaItems(left: LocalMediaItem, right: LocalMediaItem, sort: LocalMediaSort): number {
  if (sort === "type") {
    const typeDelta = localMediaTypeRank(left) - localMediaTypeRank(right);
    return typeDelta || localMediaTitle(left).localeCompare(localMediaTitle(right));
  }

  if (sort === "duration") {
    const durationDelta = localMediaDuration(right) - localMediaDuration(left);
    return durationDelta || localMediaTitle(left).localeCompare(localMediaTitle(right));
  }

  return compareLocalMediaByName(left, right);
}

function localMediaTitle(item: LocalMediaItem): string {
  return item.audioFile?.title ?? item.videoFile?.title ?? item.displayName;
}

function localMediaDuration(item: LocalMediaItem): number {
  return item.audioFile?.durationSeconds ?? item.videoFile?.durationSeconds ?? 0;
}

function compareLocalMediaByName(left: LocalMediaItem, right: LocalMediaItem): number {
  const leftAlbum = localAudioAlbumKey(left);
  const rightAlbum = localAudioAlbumKey(right);

  if (leftAlbum && leftAlbum === rightAlbum) {
    const leftTrack = left.audioFile?.trackNumber ?? Number.POSITIVE_INFINITY;
    const rightTrack = right.audioFile?.trackNumber ?? Number.POSITIVE_INFINITY;
    const trackDelta = leftTrack - rightTrack;
    if (Number.isFinite(trackDelta) && trackDelta !== 0) {
      return trackDelta;
    }
  }

  return localMediaTitle(left).localeCompare(localMediaTitle(right));
}

function localAudioAlbumKey(item: LocalMediaItem): string | undefined {
  if (!item.audioFile?.albumTitle) {
    return undefined;
  }

  return [item.rootId, item.audioFile.albumArtist ?? item.audioFile.artist ?? "", item.audioFile.albumTitle].join(":").toLowerCase();
}

function localMediaTypeRank(item: LocalMediaItem): number {
  if (item.mediaType === "audio-file") {
    return 0;
  }

  if (item.mediaType === "video-file") {
    return 1;
  }

  return 2;
}

function formatResolution(width: number | undefined, height: number | undefined): string | undefined {
  return width && height ? `${width}x${height}` : undefined;
}

function formatDvdTitleMeta(title: NonNullable<DiscInspection["dvdVideo"]>["titles"][number]): string {
  return [
    formatDuration(title.durationSeconds),
    title.chapters?.length ? `${title.chapters.length} chapters` : undefined,
    title.audioTracks?.length ? `${title.audioTracks.length} audio` : undefined,
    title.subtitleTracks?.length ? `${title.subtitleTracks.length} subtitles` : undefined,
    title.aspectRatio
  ]
    .filter(Boolean)
    .join(" - ");
}

function formatChapterDisplayName(
  chapter: NonNullable<NonNullable<DiscInspection["dvdVideo"]>["titles"][number]["chapters"]>[number]
): string {
  return chapter.title ? `${chapter.number.toString().padStart(2, "0")} - ${chapter.title}` : `Chapter ${chapter.number}`;
}

function formatChapterChipTitle(
  chapter: NonNullable<NonNullable<DiscInspection["dvdVideo"]>["titles"][number]["chapters"]>[number]
): string {
  return chapter.title ? `${chapter.number.toString().padStart(2, "0")} ${chapter.title}` : chapter.number.toString().padStart(2, "0");
}

function formatChapterMeta(
  chapter: NonNullable<NonNullable<DiscInspection["dvdVideo"]>["titles"][number]["chapters"]>[number]
): string | undefined {
  const start = formatDuration(chapter.startSeconds);
  const duration = formatDuration(chapter.durationSeconds);
  if (start && duration) {
    return chapter.title ? `${start} - ${duration}` : start;
  }

  return start ?? duration;
}

function formatChapterTooltip(
  chapter: NonNullable<NonNullable<DiscInspection["dvdVideo"]>["titles"][number]["chapters"]>[number]
): string {
  return [formatChapterDisplayName(chapter), formatChapterMeta(chapter)].filter(Boolean).join(" - ");
}

function formatAudioTrackLabel(
  track: NonNullable<NonNullable<DiscInspection["dvdVideo"]>["titles"][number]["audioTracks"]>[number],
  index: number
): string {
  return [
    formatLanguageLabel(track.language) ?? `Audio ${index + 1}`,
    track.codec?.toUpperCase(),
    track.channels
  ]
    .filter(Boolean)
    .join(" - ");
}

function formatSubtitleTrackLabel(
  track: NonNullable<NonNullable<DiscInspection["dvdVideo"]>["titles"][number]["subtitleTracks"]>[number],
  index: number
): string {
  return [formatLanguageLabel(track.language) ?? `Subtitle ${index + 1}`, formatSubtitleFormat(track.format)].filter(Boolean).join(" - ");
}

function formatLanguageLabel(language: string | undefined): string | undefined {
  const normalized = normalizeLanguageCode(language);
  if (!normalized) {
    return undefined;
  }

  const label = LANGUAGE_LABELS[normalized] ?? normalized.toUpperCase();
  return `${label} (${normalized.toUpperCase()})`;
}

function normalizeLanguageCode(language: string | undefined): string | undefined {
  if (!language) {
    return undefined;
  }

  const normalized = language.trim().toLowerCase();
  return LANGUAGE_CODE_ALIASES[normalized] ?? (/^[a-z]{2}$/.test(normalized) ? normalized : undefined);
}

function formatSubtitleFormat(format: string | undefined): string | undefined {
  if (!format) {
    return undefined;
  }

  return format === "dvd_subtitle" ? "DVD subtitle" : format;
}

function formatDuration(durationSeconds: number | undefined): string | undefined {
  if (!durationSeconds) {
    return undefined;
  }

  const totalSeconds = Math.round(durationSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatPlaybackProgress(currentSeconds: number, durationSeconds: number): string {
  return `${formatPlaybackTime(currentSeconds)} / ${formatPlaybackTime(durationSeconds)}`;
}

function formatPlaybackTime(durationSeconds: number | undefined): string {
  const totalSeconds = Math.max(0, Math.round(durationSeconds ?? 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function loadPlaybackHistory(): PlaybackResumeHistory {
  try {
    const raw = window.localStorage.getItem(PLAYBACK_HISTORY_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, PlaybackResumeEntry] => isPlaybackResumeEntry(entry[1]))
    );
  } catch {
    return {};
  }
}

function savePlaybackHistory(history: PlaybackResumeHistory): PlaybackResumeHistory {
  try {
    window.localStorage.setItem(PLAYBACK_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Resume history is a convenience feature; playback should keep working without storage.
  }
  return history;
}

function loadCollapsedLocalMediaGroups(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_LOCAL_MEDIA_GROUPS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedLocalMediaGroups(groups: Set<string>): void {
  try {
    window.localStorage.setItem(COLLAPSED_LOCAL_MEDIA_GROUPS_STORAGE_KEY, JSON.stringify([...groups]));
  } catch {
    // Collapsed groups are purely visual state.
  }
}

function loadVideoQualityPreference(): VideoQualityProfile {
  try {
    const value = window.localStorage.getItem(VIDEO_QUALITY_STORAGE_KEY);
    return value === "fast" || value === "quality" || value === "balanced" ? value : "balanced";
  } catch {
    return "balanced";
  }
}

function saveVideoQualityPreference(quality: VideoQualityProfile): void {
  try {
    window.localStorage.setItem(VIDEO_QUALITY_STORAGE_KEY, quality);
  } catch {
    // Video quality can safely fall back to the default.
  }
}

function loadTvModePreference(): boolean {
  try {
    return window.localStorage.getItem(TV_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveTvModePreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(TV_MODE_STORAGE_KEY, String(enabled));
  } catch {
    // TV mode is visual state only.
  }
}

function updatePlaybackHistory(history: PlaybackResumeHistory, entry: PlaybackResumeEntry): PlaybackResumeHistory {
  const next = { ...history };
  if (!isUsableResume(entry)) {
    delete next[entry.key];
    return next;
  }

  next[entry.key] = {
    ...entry,
    positionSeconds: Math.round(entry.positionSeconds)
  };

  return Object.fromEntries(
    Object.entries(next)
      .sort(([, left], [, right]) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, 80)
  );
}

function resumeEntryFor(history: PlaybackResumeHistory, key: string | null | undefined): PlaybackResumeEntry | undefined {
  if (!key) {
    return undefined;
  }

  const entry = history[key];
  return entry && isUsableResume(entry) ? entry : undefined;
}

function isUsableResume(entry: PlaybackResumeEntry): boolean {
  if (!Number.isFinite(entry.positionSeconds) || entry.positionSeconds < RESUME_MIN_SECONDS) {
    return false;
  }

  if (entry.durationSeconds && entry.durationSeconds - entry.positionSeconds < RESUME_END_GUARD_SECONDS) {
    return false;
  }

  return true;
}

function isPlaybackResumeEntry(value: unknown): value is PlaybackResumeEntry {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as PlaybackResumeEntry).key === "string" &&
      typeof (value as PlaybackResumeEntry).label === "string" &&
      typeof (value as PlaybackResumeEntry).mediaType === "string" &&
      typeof (value as PlaybackResumeEntry).positionSeconds === "number" &&
      typeof (value as PlaybackResumeEntry).updatedAt === "string"
  );
}

function playbackKeyForSession(session: PlaybackSession | null, snapshot: AppSnapshot): string | null {
  if (!session) {
    return null;
  }

  if (session.mediaType === "audio-cd") {
    return session.track ? audioCdTrackPlaybackKey(snapshot.disc, session.track) : null;
  }

  if (session.mediaType === "dvd-video") {
    const title = session.title ?? snapshot.disc.dvdVideo?.mainTitleId ?? snapshot.disc.dvdVideo?.titles[0]?.id;
    return title ? dvdPlaybackKey(snapshot.disc, title) : null;
  }

  if (session.mediaType === "local-dvd-video") {
    return session.localMediaId ? `local-dvd:${session.localMediaId}` : null;
  }

  if (session.mediaType === "local-audio" || session.mediaType === "local-video") {
    return session.localMediaId ? `local:${session.localMediaId}` : null;
  }

  return null;
}

function playbackLabelForSession(session: PlaybackSession | null, snapshot: AppSnapshot): string | undefined {
  if (!session) {
    return undefined;
  }

  if (session.mediaType === "audio-cd" && session.track) {
    const track = snapshot.disc.audioCd?.tracks.find((item) => item.number === session.track);
    return track?.title ?? session.displayName;
  }

  return session.displayName;
}

function localMediaPlaybackKey(item: LocalMediaItem): string {
  return item.mediaType === "dvd-video-folder" ? `local-dvd:${item.id}` : `local:${item.id}`;
}

function dvdPlaybackKey(disc: DiscInspection, title: number): string | null {
  if (disc.type !== "dvd-video") {
    return null;
  }

  return `dvd:${dvdFingerprint(disc)}:title:${title}`;
}

function audioCdTrackPlaybackKey(disc: DiscInspection, track: number): string | null {
  if (disc.type !== "audio-cd") {
    return null;
  }

  return `audio-cd:${audioCdFingerprint(disc)}:track:${track}`;
}

function latestAudioCdResume(disc: DiscInspection | undefined, history: PlaybackResumeHistory): PlaybackResumeEntry | undefined {
  if (disc?.type !== "audio-cd") {
    return undefined;
  }

  const entries = (disc.audioCd?.tracks ?? [])
    .map((track) => resumeEntryFor(history, audioCdTrackPlaybackKey(disc, track.number)))
    .filter((entry): entry is PlaybackResumeEntry => Boolean(entry))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  return entries[0];
}

function resumeEntryKeyTrack(key: string): number | undefined {
  const track = Number.parseInt(key.match(/:track:(\d+)$/)?.[1] ?? "", 10);
  return Number.isInteger(track) && track > 0 ? track : undefined;
}

function audioCdFingerprint(disc: DiscInspection): string {
  const tracks = disc.audioCd?.tracks ?? [];
  return encodeURIComponent(
    [
      disc.audioCd?.discId ?? disc.label ?? disc.mountedVolume?.label ?? "audio-cd",
      tracks.length,
      tracks.map((track) => Math.round(track.durationSeconds ?? 0)).join(",")
    ].join("|")
  );
}

function dvdFingerprint(disc: DiscInspection): string {
  return encodeURIComponent(
    [
      disc.label ?? disc.dvdVideo?.label ?? disc.mountedVolume?.label ?? "dvd",
      disc.dvdVideo?.titles.map((title) => `${title.id}.${Math.round(title.durationSeconds ?? 0)}`).join(",") ?? ""
    ].join("|")
  );
}

function pathLabel(folderPath: string): string {
  const parts = folderPath.split("/").filter(Boolean);
  return parts.at(-1) ?? folderPath;
}

function statusLine(snapshot: AppSnapshot): string {
  if (snapshot.currentSession?.displayName) {
    return `Playing ${snapshot.currentSession.displayName}`;
  }

  if (snapshot.drive.status === "no-drive") {
    return "Local library ready";
  }

  if (snapshot.disc.type === "audio-cd") {
    return "Audio CD loaded";
  }

  if (snapshot.disc.type === "dvd-video") {
    return "DVD loaded";
  }

  if (snapshot.disc.type === "data-disc") {
    return "Data disc loaded";
  }

  if (snapshot.disc.type === "unknown") {
    return "Disc loaded";
  }

  return "Ready for a disc";
}

function discHeading(snapshot: AppSnapshot | null): string {
  if (!snapshot) {
    return "Checking drive";
  }

  if (snapshot.drive.status === "no-drive") {
    return "No drive detected";
  }

  if (snapshot.disc.type === "audio-cd") {
    return snapshot.disc.audioCd?.albumTitle ?? "Audio CD ready";
  }

  if (snapshot.disc.type === "dvd-video") {
    return "DVD ready";
  }

  if (snapshot.disc.type === "data-disc") {
    return "Data disc ready";
  }

  if (snapshot.disc.type === "unknown") {
    return "Disc detected";
  }

  return "Tray ready";
}

function discMessage(snapshot: AppSnapshot | null): string {
  if (!snapshot) {
    return "Checking drive state.";
  }

  if (snapshot.drive.status === "no-drive") {
    return "Use local media now, or connect an optical drive.";
  }

  if (snapshot.disc.type === "none") {
    return "Insert a CD or DVD.";
  }

  if (snapshot.disc.type === "audio-cd") {
    return snapshot.disc.audioCd?.albumArtist
      ? "Track names are ready. Choose a track to play."
      : "Choose a track, or look up names for this CD.";
  }

  if (snapshot.disc.type === "dvd-video") {
    return "Choose a title, chapter, audio, and subtitles.";
  }

  if (snapshot.disc.type === "data-disc") {
    return "This disc is readable, but it is not a movie or audio CD.";
  }

  return "The disc is loaded, but DiscStream needs a better read.";
}

function discTypeLabel(type: DiscInspection["type"]): string {
  switch (type) {
    case "audio-cd":
      return "Audio CD";
    case "dvd-video":
      return "DVD";
    case "data-disc":
      return "Data disc";
    case "unknown":
      return "Unknown disc";
    case "none":
      return "No disc";
  }
}
