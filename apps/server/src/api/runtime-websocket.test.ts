import { describe, expect, it } from "vitest";
import { buildWebSocketHandshakeResponse, encodeWebSocketTextFrame } from "./runtime-websocket.js";

describe("runtime WebSocket helpers", () => {
  it("builds the WebSocket accept response", () => {
    expect(buildWebSocketHandshakeResponse("dGhlIHNhbXBsZSBub25jZQ==")).toContain(
      "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
    );
  });

  it("encodes a server text frame", () => {
    const frame = encodeWebSocketTextFrame({ type: "runtime-status", payload: { ok: true } });
    const length = frame[1] ?? 0;

    expect(frame[0]).toBe(0x81);
    expect(JSON.parse(frame.subarray(2, 2 + length).toString("utf8"))).toEqual({
      type: "runtime-status",
      payload: {
        ok: true
      }
    });
  });
});
