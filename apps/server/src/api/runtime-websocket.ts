import crypto from "node:crypto";
import type { Socket } from "node:net";
import type { IncomingMessage } from "node:http";
import type { FastifyInstance } from "fastify";
import type { PlatformAdapter } from "@discstream/platform";
import type { AudioCdMetadataStore } from "../config/audio-cd-metadata-store.js";
import type { DvdMetadataStore } from "../config/dvd-metadata-store.js";
import type { SessionManager } from "../sessions/session-manager.js";
import { buildRuntimeStatus, runtimeStatusKey } from "./runtime-status.js";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface RuntimeWebSocketServices {
  platform: PlatformAdapter;
  sessions: SessionManager;
  audioCdMetadata?: AudioCdMetadataStore;
  dvdMetadata?: DvdMetadataStore;
}

export interface RuntimeStatusBroadcaster {
  notify(): void;
  close(): Promise<void>;
}

export function registerRuntimeStatusWebSocket(
  app: FastifyInstance,
  services: RuntimeWebSocketServices,
  options: { path?: string; pollIntervalMs?: number } = {}
): RuntimeStatusBroadcaster {
  const path = options.path ?? "/api/runtime";
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const clients = new Set<Socket>();
  let pollTimer: NodeJS.Timeout | undefined;
  let lastStatusKey: string | undefined;
  let statusCheckInFlight = false;

  const broadcastStatus = async (force = false) => {
    if (statusCheckInFlight || clients.size === 0) {
      return;
    }

    statusCheckInFlight = true;
    try {
      const status = await buildRuntimeStatus(services.platform, services.sessions, {
        audioCdMetadata: services.audioCdMetadata,
        dvdMetadata: services.dvdMetadata
      });
      const key = runtimeStatusKey(status);
      if (force || key !== lastStatusKey) {
        lastStatusKey = key;
        broadcast(clients, {
          type: "runtime-status",
          payload: status
        });
      }
    } catch (error) {
      broadcast(clients, {
        type: "error",
        message: error instanceof Error ? error.message : "Runtime status could not be refreshed."
      });
    } finally {
      statusCheckInFlight = false;
    }
  };

  const ensurePoller = () => {
    if (pollTimer) {
      return;
    }

    pollTimer = setInterval(() => {
      void broadcastStatus(false);
    }, pollIntervalMs);
  };

  const stopPollerIfIdle = () => {
    if (!pollTimer || clients.size > 0) {
      return;
    }

    clearInterval(pollTimer);
    pollTimer = undefined;
    lastStatusKey = undefined;
  };

  const onUpgrade = (request: IncomingMessage, socket: Socket) => {
    if (!request.url || new URL(request.url, "http://localhost").pathname !== path) {
      return;
    }

    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }

    socket.write(buildWebSocketHandshakeResponse(key));
    clients.add(socket);
    ensurePoller();

    socket.on("data", (chunk) => {
      handleClientFrame(socket, chunk);
    });
    socket.once("close", () => {
      clients.delete(socket);
      stopPollerIfIdle();
    });
    socket.once("error", () => {
      clients.delete(socket);
      stopPollerIfIdle();
    });

    void broadcastStatus(true);
  };

  app.server.on("upgrade", onUpgrade);
  app.addHook("onClose", async () => {
    app.server.off("upgrade", onUpgrade);
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }

    for (const client of clients) {
      client.end(encodeWebSocketFrame(Buffer.alloc(0), 0x8));
      client.destroy();
    }
    clients.clear();
  });

  return {
    notify() {
      void broadcastStatus(true);
    },
    async close() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }

      for (const client of clients) {
        client.end(encodeWebSocketFrame(Buffer.alloc(0), 0x8));
      }
      clients.clear();
    }
  };
}

export function buildWebSocketHandshakeResponse(key: string): string {
  const accept = crypto.createHash("sha1").update(`${key}${WEBSOCKET_GUID}`).digest("base64");
  return [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n"
  ].join("\r\n");
}

export function encodeWebSocketTextFrame(payload: unknown): Buffer {
  return encodeWebSocketFrame(Buffer.from(JSON.stringify(payload), "utf8"), 0x1);
}

function broadcast(clients: Set<Socket>, payload: unknown): void {
  const frame = encodeWebSocketTextFrame(payload);
  for (const client of clients) {
    if (!client.destroyed && client.writable) {
      client.write(frame);
    }
  }
}

function handleClientFrame(socket: Socket, chunk: Buffer): void {
  const opcode = chunk[0] ? chunk[0] & 0x0f : 0;
  if (opcode === 0x8) {
    socket.end(encodeWebSocketFrame(Buffer.alloc(0), 0x8));
    return;
  }

  if (opcode === 0x9) {
    socket.write(encodeWebSocketFrame(Buffer.alloc(0), 0x0a));
  }
}

function encodeWebSocketFrame(payload: Buffer, opcode: number): Buffer {
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, length]), payload]);
  }

  if (length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}
