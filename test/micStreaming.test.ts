// Unit tests for the mic orchestrator (src/agent/micStreaming.ts): control
// sequencing, the continuous/PTT mutual exclusion, permission states, and that
// capture/permission errors SURFACE (console.error + agentStore), never swallowed.
//
// micCapture + bmwRenderer's send side are mocked so this focuses purely on the
// orchestration logic; agentStore is REAL so we observe the UI-visible state.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The capture seam is mocked; MicCaptureException must be a real class so the
// orchestrator's `instanceof` narrowing works against it.
vi.mock("../src/audio/micCapture", () => {
  class MicCaptureException extends Error {
    constructor(
      public readonly kind: "denied" | "unsupported" | "failed",
      message: string,
    ) {
      super(message);
      this.name = "MicCaptureException";
    }
  }
  return {
    startCapture: vi.fn(async () => {}),
    stopCapture: vi.fn(),
    MicCaptureException,
  };
});

// The transport is mocked so we assert the exact control sequence.
vi.mock("../src/agent/bmwRenderer", () => ({
  sendControl: vi.fn(),
  sendAudio: vi.fn(),
  resetAudioFrameCount: vi.fn(),
}));

import { startCapture, stopCapture, MicCaptureException } from "../src/audio/micCapture";
import { sendControl, sendAudio, resetAudioFrameCount } from "../src/agent/bmwRenderer";
import {
  toggleContinuousMic,
  pttDown,
  pttUp,
  _resetForTest,
} from "../src/agent/micStreaming";
import {
  getAgentState,
  setMicStreaming,
  setPttActive,
  setMicPermission,
} from "../src/agent/agentStore";

const mockStart = vi.mocked(startCapture);
const mockStop = vi.mocked(stopCapture);
const mockSendControl = vi.mocked(sendControl);

function controlCmds(): string[] {
  return mockSendControl.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStart.mockResolvedValue(undefined);
  _resetForTest();
  setMicStreaming(false);
  setPttActive(false);
  setMicPermission("unknown");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── continuous toggle ────────────────────────────────────────────────────────
describe("toggleContinuousMic", () => {
  it("off → on: starts capture, emits mic_start, sets streaming + granted", async () => {
    await toggleContinuousMic();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledWith(sendAudio);
    expect(resetAudioFrameCount).toHaveBeenCalled();
    expect(controlCmds()).toEqual(["mic_start"]);
    expect(getAgentState().micStreaming).toBe(true);
    expect(getAgentState().micPermission).toBe("granted");
  });

  it("on → off: emits mic_stop, stops capture, clears streaming", async () => {
    await toggleContinuousMic(); // on
    mockSendControl.mockClear();
    await toggleContinuousMic(); // off
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(controlCmds()).toEqual(["mic_stop"]);
    expect(getAgentState().micStreaming).toBe(false);
  });

  it("rolls streaming back to false when capture fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockStart.mockRejectedValueOnce(new MicCaptureException("failed", "nope"));
    await toggleContinuousMic();
    expect(getAgentState().micStreaming).toBe(false);
    expect(controlCmds()).toEqual([]); // no mic_start when capture failed
  });
});

// ── push-to-talk ─────────────────────────────────────────────────────────────
describe("push-to-talk", () => {
  it("down → up: ptt_down then ptt_up, capture started + stopped", async () => {
    await pttDown();
    expect(getAgentState().pttActive).toBe(true);
    expect(controlCmds()).toEqual(["ptt_down"]);
    pttUp();
    expect(getAgentState().pttActive).toBe(false);
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(controlCmds()).toEqual(["ptt_down", "ptt_up"]);
  });

  it("pttUp when not held is a safe no-op on the wire", () => {
    pttUp();
    expect(controlCmds()).toEqual([]);
    expect(mockStop).not.toHaveBeenCalled();
  });

  it("rolls pttActive back to false when capture fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockStart.mockRejectedValueOnce(new MicCaptureException("denied", "no"));
    await pttDown();
    expect(getAgentState().pttActive).toBe(false);
    expect(controlCmds()).toEqual([]);
  });
});

// ── mutual exclusion (one physical mic → one logical stream) ──────────────────
describe("mutual exclusion", () => {
  it("PTT is ignored while the continuous mic owns the mic", async () => {
    await toggleContinuousMic(); // continuous now active
    mockSendControl.mockClear();
    mockStart.mockClear();
    await pttDown();
    expect(mockStart).not.toHaveBeenCalled();
    expect(controlCmds()).toEqual([]);
    expect(getAgentState().pttActive).toBe(false);
  });

  it("continuous toggle is ignored while PTT owns the mic", async () => {
    await pttDown(); // ptt active
    mockSendControl.mockClear();
    mockStart.mockClear();
    await toggleContinuousMic();
    // optimistic streaming flag is rolled back because begin() refuses
    expect(mockStart).not.toHaveBeenCalled();
    expect(getAgentState().micStreaming).toBe(false);
  });
});

// ── permission / error surfacing ─────────────────────────────────────────────
describe("permission + error surfacing", () => {
  it("denied → micPermission 'denied' AND console.error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockStart.mockRejectedValueOnce(new MicCaptureException("denied", "blocked"));
    await toggleContinuousMic();
    expect(getAgentState().micPermission).toBe("denied");
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("unsupported → micPermission 'error' AND console.error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockStart.mockRejectedValueOnce(new MicCaptureException("unsupported", "no web audio"));
    await pttDown();
    expect(getAgentState().micPermission).toBe("error");
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("a non-MicCaptureException error still surfaces via console.error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockStart.mockRejectedValueOnce(new Error("unexpected"));
    await toggleContinuousMic();
    expect(getAgentState().micPermission).toBe("error");
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("the error is ALSO reflected in the in-UI console log", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockStart.mockRejectedValueOnce(new MicCaptureException("failed", "boom"));
    await toggleContinuousMic();
    const log = getAgentState().consoleLog;
    const last = log[log.length - 1];
    expect(last.level).toBe("error");
    expect(last.text).toContain("mic:");
  });
});
