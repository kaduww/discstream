import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { PlatformCapabilities } from "@discstream/contracts";
import { LocalMediaSourceManager } from "@discstream/local-media";
import { selectH264VideoEncoder, SessionManager } from "./session-manager.js";

describe("SessionManager", () => {
  it("cleans stale stream session directories on startup", async () => {
    const streamsDir = await mkdtemp(path.join(os.tmpdir(), "discstream-streams-"));
    const staleSessionId = "73303000-c4df-4132-aaac-766c2f5f8ec0";
    const staleSessionDir = path.join(streamsDir, staleSessionId);
    const manualDir = path.join(streamsDir, "manual-cache");
    await mkdir(staleSessionDir, { recursive: true });
    await mkdir(manualDir, { recursive: true });
    await writeFile(path.join(staleSessionDir, "segment-00000.ts"), "old segment");
    await writeFile(path.join(streamsDir, ".gitkeep"), "");

    const localMedia = new LocalMediaSourceManager({
      roots: [],
      enableFfprobe: false
    });
    const sessions = new SessionManager(localMedia, { streamsDir });

    await expect(sessions.cleanupStaleStreams()).resolves.toBe(1);
    await expect(access(staleSessionDir)).rejects.toBeTruthy();
    await expect(access(manualDir)).resolves.toBeUndefined();
    await expect(access(path.join(streamsDir, ".gitkeep"))).resolves.toBeUndefined();
  });

  it("clears the active local session on stop", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "discstream-session-"));
    await writeFile(path.join(rootPath, "track.mp3"), "fake mp3");

    const localMedia = new LocalMediaSourceManager({
      roots: [
        {
          displayName: "Test Music",
          path: rootPath,
          enabled: true
        }
      ],
      enableFfprobe: false
    });
    const item = (await localMedia.list()).items[0];
    expect(item).toBeDefined();

    const streamsDir = await mkdtemp(path.join(os.tmpdir(), "discstream-streams-"));
    const sessions = new SessionManager(localMedia, { streamsDir });
    const session = await sessions.create({
      mediaType: "local-audio",
      localMediaId: item!.id,
      replace: false
    });

    expect(session.streamUrl).toContain("/stream");
    expect(sessions.current?.sessionId).toBe(session.sessionId);

    const stopped = await sessions.stop();

    expect(stopped.status).toBe("stopped");
    expect(stopped.streamUrl).toBeUndefined();
    expect(sessions.current).toBeNull();
  });

  it("starts a local HLS video session for files that need transcoding", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "discstream-video-"));
    await writeFile(path.join(rootPath, "movie.mkv"), "fake video");
    const streamsDir = await mkdtemp(path.join(os.tmpdir(), "discstream-streams-"));
    let stopped = false;
    let videoEncoder: string | undefined;

    const localMedia = new LocalMediaSourceManager({
      roots: [
        {
          displayName: "Test Videos",
          path: rootPath,
          enabled: true
        }
      ],
      enableFfprobe: false
    });
    const item = (await localMedia.list()).items[0];
    expect(item?.videoFile?.transcodeRequired).toBe(true);

    const sessions = new SessionManager(localMedia, {
      streamsDir,
      detectCapabilities: async () => testCapabilities({ platform: "darwin", h264VideoToolbox: true }),
      transcodeLocalVideo: async (request) => {
        videoEncoder = request.videoEncoder;
        return {
          playlistPath: path.join(request.outputDir, "master.m3u8"),
          stop: async () => {
            stopped = true;
          }
        };
      }
    });

    const session = await sessions.create({
      mediaType: "local-video",
      localMediaId: item!.id,
      replace: false
    });

    expect(session.streamUrl).toMatch(/^\/streams\/.+\/master\.m3u8$/);
    expect(session.status).toBe("playing");
    expect(videoEncoder).toBe("h264_videotoolbox");
    expect(session.videoEncoder).toBe("h264_videotoolbox");

    await sessions.stop();

    expect(stopped).toBe(true);
    expect(sessions.current).toBeNull();
  });

  it("selects the best available H.264 encoder for the host", () => {
    expect(selectH264VideoEncoder(testCapabilities({ platform: "darwin", h264VideoToolbox: true }))).toBe("h264_videotoolbox");
    expect(selectH264VideoEncoder(testCapabilities({ platform: "linux", h264V4l2m2m: true }))).toBe("h264_v4l2m2m");
    expect(selectH264VideoEncoder(testCapabilities({ platform: "linux", libx264: true }))).toBe("libx264");
  });

  it("starts and stops an Audio CD stream session", async () => {
    const streamsDir = await mkdtemp(path.join(os.tmpdir(), "discstream-streams-"));
    let stopped = false;

    const localMedia = new LocalMediaSourceManager({
      roots: [],
      enableFfprobe: false
    });
    const sessions = new SessionManager(localMedia, {
      streamsDir,
      detectOpticalDrives: async () => [
        {
          id: "drive-0",
          systemDevice: "/dev/sr0",
          displayName: "Test Drive",
          transport: "usb",
          capabilities: {
            audioCd: true,
            dvdVideo: true,
            eject: true,
            closeTray: false
          }
        }
      ],
      inspectDisc: async (driveId) => ({
        driveId,
        type: "audio-cd",
        audioCd: {
          tracks: [],
          metadataSource: "none"
        },
        warnings: [],
        inspectedAt: new Date().toISOString()
      }),
      streamAudioCd: async (request) => ({
        contentType: "audio/mpeg",
        stream: Readable.from([`track-${request.track}`]),
        stop: async () => {
          stopped = true;
        }
      })
    });

    const session = await sessions.create({
      mediaType: "audio-cd",
      driveId: "drive-0",
      track: 2,
      startSeconds: 12,
      replace: false
    });

    expect(session.streamUrl).toMatch(/^\/api\/sessions\/.+\/audio$/);
    expect(session.track).toBe(2);
    expect(session.startSeconds).toBe(12);
    expect(session.displayName).toBe("Audio CD - Track 2");

    const running = await sessions.openAudioCdStream(session.sessionId);
    expect(running.contentType).toBe("audio/mpeg");

    await sessions.stop();

    expect(stopped).toBe(true);
    expect(sessions.current).toBeNull();
  });

  it("prepares mounted Audio CD tracks as stable MP3 files", async () => {
    const streamsDir = await mkdtemp(path.join(os.tmpdir(), "discstream-streams-"));
    const mountPath = await mkdtemp(path.join(os.tmpdir(), "discstream-audio-cd-"));
    await writeFile(path.join(mountPath, "1 First Track.aiff"), "fake aiff");

    const localMedia = new LocalMediaSourceManager({
      roots: [],
      enableFfprobe: false
    });
    const sessions = new SessionManager(localMedia, {
      streamsDir,
      detectOpticalDrives: async () => [
        {
          id: "drive-0",
          systemDevice: "/dev/disk4",
          displayName: "Mounted Audio CD",
          transport: "unknown",
          capabilities: {
            audioCd: true,
            dvdVideo: true,
            eject: true,
            closeTray: true
          }
        }
      ],
      inspectDisc: async (driveId) => ({
        driveId,
        type: "audio-cd",
        mountedVolume: {
          mountPath,
          label: "Audio CD",
          filesystem: "cddafs"
        },
        audioCd: {
          tracks: [],
          metadataSource: "none"
        },
        warnings: [],
        inspectedAt: new Date().toISOString()
      }),
      prepareAudioCdFile: async (_source, outputPath) => {
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, "prepared mp3");
      }
    });

    const session = await sessions.create({
      mediaType: "audio-cd",
      driveId: "drive-0",
      track: 1,
      replace: false
    });

    expect(session.streamUrl).toMatch(/^\/streams\/.+\/track\.mp3$/);
    expect(session.displayName).toBe("1 First Track");

    const preparedPath = path.join(streamsDir, session.sessionId, "track.mp3");
    await expect(access(preparedPath)).resolves.toBeUndefined();

    await sessions.stop();

    await expect(access(preparedPath)).rejects.toBeTruthy();
  });

  it("starts mounted Audio CD tracks through the progressive audio endpoint by default", async () => {
    const streamsDir = await mkdtemp(path.join(os.tmpdir(), "discstream-streams-"));
    const mountPath = await mkdtemp(path.join(os.tmpdir(), "discstream-audio-cd-"));
    await writeFile(path.join(mountPath, "1 First Track.aiff"), "fake aiff");

    const localMedia = new LocalMediaSourceManager({
      roots: [],
      enableFfprobe: false
    });
    const sessions = new SessionManager(localMedia, {
      streamsDir,
      detectOpticalDrives: async () => [
        {
          id: "drive-0",
          systemDevice: "/dev/disk4",
          displayName: "Mounted Audio CD",
          transport: "unknown",
          capabilities: {
            audioCd: true,
            dvdVideo: true,
            eject: true,
            closeTray: true
          }
        }
      ],
      inspectDisc: async (driveId) => ({
        driveId,
        type: "audio-cd",
        mountedVolume: {
          mountPath,
          label: "Audio CD",
          filesystem: "cddafs"
        },
        audioCd: {
          tracks: [],
          metadataSource: "none"
        },
        warnings: [],
        inspectedAt: new Date().toISOString()
      })
    });

    const session = await sessions.create({
      mediaType: "audio-cd",
      driveId: "drive-0",
      track: 1,
      replace: false
    });

    expect(session.streamUrl).toMatch(/^\/api\/sessions\/.+\/audio$/);
    expect(session.displayName).toBe("1 First Track");
  });

  it("can start mounted Audio CD tracks through a custom HLS transcoder", async () => {
    const streamsDir = await mkdtemp(path.join(os.tmpdir(), "discstream-streams-"));
    const mountPath = await mkdtemp(path.join(os.tmpdir(), "discstream-audio-cd-"));
    await writeFile(path.join(mountPath, "1 First Track.aiff"), "fake aiff");
    let stopped = false;

    const localMedia = new LocalMediaSourceManager({
      roots: [],
      enableFfprobe: false
    });
    const sessions = new SessionManager(localMedia, {
      streamsDir,
      detectOpticalDrives: async () => [
        {
          id: "drive-0",
          systemDevice: "/dev/disk4",
          displayName: "Mounted Audio CD",
          transport: "unknown",
          capabilities: {
            audioCd: true,
            dvdVideo: true,
            eject: true,
            closeTray: true
          }
        }
      ],
      inspectDisc: async (driveId) => ({
        driveId,
        type: "audio-cd",
        mountedVolume: {
          mountPath,
          label: "Audio CD",
          filesystem: "cddafs"
        },
        audioCd: {
          tracks: [],
          metadataSource: "none"
        },
        warnings: [],
        inspectedAt: new Date().toISOString()
      }),
      transcodeAudioCdToHls: async (request) => {
        await mkdir(request.outputDir, { recursive: true });
        const playlistPath = path.join(request.outputDir, "master.m3u8");
        await writeFile(playlistPath, "#EXTM3U\n#EXTINF:2,\nsegment-00000.ts\n");
        return {
          playlistPath,
          stop: async () => {
            stopped = true;
          }
        };
      }
    });

    const session = await sessions.create({
      mediaType: "audio-cd",
      driveId: "drive-0",
      track: 1,
      replace: false
    });

    expect(session.streamUrl).toMatch(/^\/streams\/.+\/master\.m3u8$/);

    await sessions.stop();

    expect(stopped).toBe(true);
  });

  it("starts a mounted DVD-Video disc as HLS", async () => {
    const streamsDir = await mkdtemp(path.join(os.tmpdir(), "discstream-streams-"));
    const mountPath = await mkdtemp(path.join(os.tmpdir(), "discstream-dvd-"));
    let stopped = false;
    let inputPath: string | undefined;
    let audioTrack: number | null | undefined;
    let startSeconds: number | null | undefined;

    const localMedia = new LocalMediaSourceManager({
      roots: [],
      enableFfprobe: false
    });
    const sessions = new SessionManager(localMedia, {
      streamsDir,
      detectOpticalDrives: async () => [
        {
          id: "drive-0",
          systemDevice: "/dev/disk5",
          displayName: "DVD Drive",
          transport: "unknown",
          capabilities: {
            audioCd: true,
            dvdVideo: true,
            eject: true,
            closeTray: true
          }
        }
      ],
      inspectDisc: async (driveId) => ({
        driveId,
        type: "dvd-video",
        label: "Movie Disc",
        mountedVolume: {
          mountPath,
          label: "Movie Disc",
          filesystem: "udf"
        },
        dvdVideo: {
          label: "Movie Disc",
          titles: [],
          metadataSource: "none"
        },
        warnings: [],
        inspectedAt: new Date().toISOString()
      }),
      transcodeDvdVideo: async (request) => {
        inputPath = request.videoTsPath;
        audioTrack = request.audioTrack;
        startSeconds = request.startSeconds;
        await mkdir(request.outputDir, { recursive: true });
        const playlistPath = path.join(request.outputDir, "master.m3u8");
        await writeFile(playlistPath, "#EXTM3U\n#EXTINF:4,\nsegment-00000.ts\n");
        return {
          playlistPath,
          stop: async () => {
            stopped = true;
          }
        };
      }
    });

    const session = await sessions.create({
      mediaType: "dvd-video",
      driveId: "drive-0",
      title: 1,
      chapter: 4,
      startSeconds: 83.5,
      audioTrack: 3,
      replace: false
    });

    expect(inputPath).toBe(mountPath);
    expect(audioTrack).toBe(3);
    expect(startSeconds).toBe(83.5);
    expect(session.mediaType).toBe("dvd-video");
    expect(session.streamUrl).toMatch(/^\/streams\/.+\/master\.m3u8$/);
    expect(session.displayName).toBe("Movie Disc - Title 1 - Chapter 4");

    await sessions.stop();

    expect(stopped).toBe(true);
  });

  it("starts a local VIDEO_TS folder as HLS", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "discstream-local-dvd-"));
    const moviePath = path.join(rootPath, "Movie");
    const videoTsPath = path.join(moviePath, "VIDEO_TS");
    await mkdir(videoTsPath, { recursive: true });
    await writeFile(path.join(videoTsPath, "VTS_01_1.VOB"), "fake vob");

    const streamsDir = await mkdtemp(path.join(os.tmpdir(), "discstream-streams-"));
    let inputPath: string | undefined;

    const localMedia = new LocalMediaSourceManager({
      roots: [
        {
          displayName: "DVDs",
          path: rootPath,
          enabled: true
        }
      ],
      enableFfprobe: false
    });
    const item = (await localMedia.list()).items.find((candidate) => candidate.mediaType === "dvd-video-folder");
    expect(item?.displayName).toBe("Movie");

    const sessions = new SessionManager(localMedia, {
      streamsDir,
      transcodeDvdVideo: async (request) => {
        inputPath = request.videoTsPath;
        await mkdir(request.outputDir, { recursive: true });
        const playlistPath = path.join(request.outputDir, "master.m3u8");
        await writeFile(playlistPath, "#EXTM3U\n#EXTINF:4,\nsegment-00000.ts\n");
        return {
          playlistPath,
          stop: async () => undefined
        };
      }
    });

    const session = await sessions.create({
      mediaType: "local-dvd-video",
      localMediaId: item!.id,
      replace: false
    });

    expect(inputPath).toBe(videoTsPath);
    expect(session.mediaType).toBe("local-dvd-video");
    expect(session.streamUrl).toMatch(/^\/streams\/.+\/master\.m3u8$/);
    expect(session.displayName).toBe("Movie");
  });
});

function testCapabilities(options: {
  platform: PlatformCapabilities["platform"];
  libx264?: boolean;
  h264VideoToolbox?: boolean;
  h264V4l2m2m?: boolean;
}): PlatformCapabilities {
  return {
    platform: options.platform,
    architecture: "arm64",
    commands: {
      ffmpeg: true,
      ffprobe: true,
      cdparanoia: false,
      cdInfo: false,
      discid: false,
      dvdbackup: false,
      lsdvd: false,
      eject: false,
      lsblk: false,
      udevadm: false,
      udisksctl: false,
      diskutil: options.platform === "darwin",
      drutil: options.platform === "darwin",
      ioreg: options.platform === "darwin"
    },
    videoEncoders: {
      libx264: options.libx264 ?? false,
      h264VideoToolbox: options.h264VideoToolbox ?? false,
      h264V4l2m2m: options.h264V4l2m2m ?? false
    },
    audioEncoders: {
      aac: true,
      libmp3lame: true,
      flac: true
    },
    opticalDrives: 0,
    paths: {
      configDir: "/tmp/config",
      dataDir: "/tmp/data",
      cacheDir: "/tmp/cache",
      logDir: "/tmp/logs",
      streamsDir: "/tmp/streams",
      coversDir: "/tmp/covers"
    }
  };
}
