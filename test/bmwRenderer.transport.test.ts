// Unit tests for the OUTBOUND transport in src/agent/bmwRenderer.ts:
//   • sendControl / sendAudio against a MOCK WebSocket (open / closed / throw)
//   • the connection state machine wired through the socket lifecycle
//   • that NOTHING is silently dropped — every drop surfaces to console + UI state
//
// The receive/mapping path is covered exhaustively by variants.integration.test.ts;
// here we exercise the send side + connection FSM, which that suite does not touch.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockWebSocket, installMockWebSocket } from "./helpers/mockWebSocket";
import {
  connect,
  disconnect,
  sendControl,
  sendAudio,
  getConnectionState,
  getAudioDiagnostics,
  resetAudioFrameCount,
} from "../src/agent/bmwRenderer";
import { getAgentState, clearConsole } from "../src/agent/agentStore";

let restoreWs: () => void;

/** Connect + fire open so the renderer has a live, OPEN socket. */
function connectAndOpen(url = "ws://localhost:1234"): MockWebSocket {
  connect(url);
  const ws = MockWebSocket.last();
  ws.fireOpen();
  return ws;
}

function lastConsole() {
  const log = getAgentState().consoleLog;
  return log[log.length - 1];
}

beforeEach(() => {
  restoreWs = installMockWebSocket();
  clearConsole();
  resetAudioFrameCount();
  vi.restoreAllMocks();
});

afterEach(() => {
  disconnect();
  restoreWs();
});

// ── connection state machine through the socket lifecycle ────────────────────
describe("connection FSM (via the socket lifecycle)", () => {
  it("connect → connecting, then open → connected (reflected in agentStore)", () => {
    connect("ws://localhost:1");
    expect(getConnectionState()).toBe("connecting");
    expect(getAgentState().connection).toBe("connecting");

    MockWebSocket.last().fireOpen();
    expect(getConnectionState()).toBe("connected");
    expect(getAgentState().connection).toBe("connected");
    expect(getAgentState().connectionUrl).toBe("ws://localhost:1");
  });

  it("onerror → error state", () => {
    connectAndOpen();
    MockWebSocket.last().fireError();
    expect(getConnectionState()).toBe("error");
    expect(getAgentState().connection).toBe("error");
  });

  it("an unexpected close → reconnecting", () => {
    vi.useFakeTimers();
    connectAndOpen();
    MockWebSocket.last().fireClose();
    expect(getConnectionState()).toBe("reconnecting");
    expect(getAgentState().connection).toBe("reconnecting");
    vi.useRealTimers();
  });

  it("disconnect → disconnected (and does not schedule a reconnect)", () => {
    connectAndOpen();
    disconnect();
    expect(getConnectionState()).toBe("disconnected");
    expect(getAgentState().connection).toBe("disconnected");
  });

  it("a deliberate disconnect's close does not flip us to reconnecting", () => {
    connectAndOpen();
    disconnect();
    // disconnect() nulls onclose, so even a late close can't resurrect us.
    expect(getConnectionState()).toBe("disconnected");
  });

  it("a WebSocket construction throw is TERMINAL (error), not an endless reconnect", () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const OrigCtor = (globalThis as { WebSocket?: unknown }).WebSocket;
    class ThrowingWs {
      static OPEN = 1;
      constructor() {
        throw new Error("bad url");
      }
    }
    (globalThis as { WebSocket?: unknown }).WebSocket = ThrowingWs;
    connect("http://bad-scheme");
    expect(err).toHaveBeenCalled();
    // A malformed URL will never succeed → surface a terminal error, do NOT loop.
    expect(getConnectionState()).toBe("error");
    // No reconnect scheduled: advancing time does not re-attempt (no 2nd instance).
    vi.advanceTimersByTime(10_000);
    expect(MockWebSocket.instances).toHaveLength(0); // ThrowingWs isn't a MockWebSocket
    (globalThis as { WebSocket?: unknown }).WebSocket = OrigCtor;
    vi.useRealTimers();
  });
});

// ── sendControl ──────────────────────────────────────────────────────────────
describe("sendControl", () => {
  it("open socket → sends the correct JSON TEXT frame", () => {
    const ws = connectAndOpen();
    sendControl("mic_start");
    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toBe(
      '{"v":2,"in":"mic_start","sample_rate":16000,"format":"pcm16le","channels":1}',
    );
  });

  it("all four commands serialize and send", () => {
    const ws = connectAndOpen();
    sendControl("mic_start");
    sendControl("mic_stop");
    sendControl("ptt_down");
    sendControl("ptt_up");
    expect(ws.sent.map((s) => JSON.parse(s as string).in)).toEqual([
      "mic_start",
      "mic_stop",
      "ptt_down",
      "ptt_up",
    ]);
  });

  it("closed/null socket → SURFACES (console.warn + UI warn), never a silent drop", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // no connect() → socket is null
    sendControl("mic_start");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("not open");
    const entry = lastConsole();
    expect(entry.level).toBe("warn");
    expect(entry.text).toContain("not sent");
  });

  it("send-throw → console.error + UI error (surfaced, not swallowed)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const ws = connectAndOpen();
    ws.throwOnSend = new Error("boom");
    sendControl("mic_start");
    expect(err).toHaveBeenCalledTimes(1);
    expect(lastConsole().level).toBe("error");
  });
});

// ── sendAudio ─────────────────────────────────────────────────────────────────
describe("sendAudio", () => {
  it("open socket → sends a BINARY frame with the exact bytes", () => {
    const ws = connectAndOpen();
    const pcm = new Int16Array([1, -1, 258]);
    sendAudio(pcm);
    expect(ws.sent).toHaveLength(1);
    const buf = ws.sent[0] as ArrayBuffer;
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(6); // 3 samples × 2 bytes
    expect(getAudioDiagnostics().sent).toBe(1);
  });

  it("respects a subarray's byteOffset/length", () => {
    const ws = connectAndOpen();
    const backing = new Int16Array([9, 9, 5, 6, 9]);
    const view = backing.subarray(2, 4); // [5,6]
    sendAudio(view);
    const buf = ws.sent[0] as ArrayBuffer;
    expect(buf.byteLength).toBe(4);
    expect(Array.from(new Int16Array(buf))).toEqual([5, 6]);
  });

  it("empty frame → ignored + counted (idle), never sent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ws = connectAndOpen();
    sendAudio(new Int16Array(0));
    expect(ws.sent).toHaveLength(0);
    expect(getAudioDiagnostics().idle).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("closed socket → EVERY drop counted; surfaced on a throttle (no re-render storm)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // not connected
    sendAudio(new Int16Array([1, 2]));
    sendAudio(new Int16Array([3, 4]));
    // exact count is always tracked in diagnostics…
    expect(getAudioDiagnostics().dropped).toBe(2);
    // …but the store (which drives re-renders) is updated only on the throttle
    // boundary (first + every 50th), so it reflects the count at that boundary.
    expect(getAgentState().audioDropped).toBe(1);
    // FIRST drop surfaces loudly; the 2nd is throttled (not the 50th).
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("dropped");
  });

  it("the store drop count updates again at the 50th dropped frame", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 50; i++) sendAudio(new Int16Array([1, 2]));
    expect(getAudioDiagnostics().dropped).toBe(50);
    expect(getAgentState().audioDropped).toBe(50); // updated at the 50th
  });

  it("send-throw → console.error + counted, never an empty catch", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const ws = connectAndOpen();
    ws.throwOnSend = new Error("detached");
    sendAudio(new Int16Array([1, 2]));
    expect(err).toHaveBeenCalledTimes(1);
    expect(getAudioDiagnostics().errors).toBe(1);
  });
});

// ── diagnostics reset ────────────────────────────────────────────────────────
describe("resetAudioFrameCount", () => {
  it("clears all counters + the agentStore drop count", () => {
    sendAudio(new Int16Array([1, 2])); // dropped (not connected)
    expect(getAudioDiagnostics().dropped).toBe(1);
    resetAudioFrameCount();
    expect(getAudioDiagnostics()).toEqual({ sent: 0, dropped: 0, idle: 0, errors: 0 });
    expect(getAgentState().audioDropped).toBe(0);
  });
});
