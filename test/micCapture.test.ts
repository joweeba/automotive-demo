// Unit tests for src/audio/micCapture.ts via the injectable CaptureEnv seam.
// We mock the standardized-audio-context AudioContext/AudioWorkletNode + a fake
// MediaStream and assert the graph-setup wiring, the permission/unsupported/failed
// error mapping, the AudioContext resume behaviour, and that NOTHING is swallowed.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  startCapture,
  stopCapture,
  isCapturing,
  MicCaptureException,
  defaultCaptureEnv,
  _resetForTest,
  type CaptureEnv,
  type CaptureContext,
  type CaptureNode,
} from "../src/audio/micCapture";

interface Harness {
  env: CaptureEnv;
  ctx: CaptureContext & {
    state: string;
    resume: ReturnType<typeof vi.fn>;
    audioWorklet: { addModule: ReturnType<typeof vi.fn> };
    createMediaStreamSource: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  node: CaptureNode;
  source: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  track: { stop: ReturnType<typeof vi.fn> };
  getUserMedia: ReturnType<typeof vi.fn>;
}

/** Build a fully-working fake env; pass overrides to break specific pieces. */
function makeHarness(over: Partial<CaptureEnv> = {}): Harness {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const node: CaptureNode = {
    port: { onmessage: null },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const ctx = {
    state: "suspended" as string,
    resume: vi.fn(async () => {
      ctx.state = "running";
    }),
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createMediaStreamSource: vi.fn(() => source),
    destination: { id: "dest" },
    close: vi.fn(),
  };
  const getUserMedia = vi.fn(async () => stream);
  const env: CaptureEnv = {
    getUserMedia,
    createContext: () => ctx as unknown as CaptureContext,
    createNode: () => node,
    createObjectURL: () => "blob:mock-worklet",
    ...over,
  };
  return {
    env,
    ctx: ctx as unknown as Harness["ctx"],
    node,
    source,
    track,
    getUserMedia,
  };
}

beforeEach(() => {
  _resetForTest();
  vi.restoreAllMocks();
});

afterEach(() => {
  _resetForTest();
});

// ── happy path: graph wiring ─────────────────────────────────────────────────
describe("startCapture — graph wiring", () => {
  it("acquires a mono mic, builds + connects the worklet graph", async () => {
    const h = makeHarness();
    const onFrame = vi.fn();
    await startCapture(onFrame, h.env);

    expect(h.getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    expect(h.ctx.audioWorklet.addModule).toHaveBeenCalledWith("blob:mock-worklet");
    expect(h.ctx.createMediaStreamSource).toHaveBeenCalledTimes(1);
    // source → node → destination
    expect(h.source.connect).toHaveBeenCalledWith(h.node);
    expect(h.node.connect).toHaveBeenCalledWith(h.ctx.destination);
    expect(isCapturing()).toBe(true);
  });

  it("delivers worklet frames to onFrame as Int16Array", async () => {
    const h = makeHarness();
    const onFrame = vi.fn();
    await startCapture(onFrame, h.env);

    const buf = new Int16Array([1, 2, 3]).buffer;
    h.node.port.onmessage!({ data: buf } as MessageEvent);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(Array.from(onFrame.mock.calls[0][0])).toEqual([1, 2, 3]);
  });

  it("ignores a non-ArrayBuffer worklet message (no throw)", async () => {
    const h = makeHarness();
    const onFrame = vi.fn();
    await startCapture(onFrame, h.env);
    h.node.port.onmessage!({ data: "junk" } as MessageEvent);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("is idempotent — a second start while capturing does not re-acquire", async () => {
    const h = makeHarness();
    await startCapture(vi.fn(), h.env);
    await startCapture(vi.fn(), h.env);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
  });
});

// ── AudioContext resume (Chrome autoplay-suspend fix) ────────────────────────
describe("startCapture — AudioContext resume", () => {
  it("resumes a suspended context so audio actually flows", async () => {
    const h = makeHarness();
    await startCapture(vi.fn(), h.env);
    expect(h.ctx.resume).toHaveBeenCalled();
    expect(h.ctx.state).toBe("running");
  });

  it("does not fail if the context is already running", async () => {
    const h = makeHarness();
    h.ctx.state = "running";
    await startCapture(vi.fn(), h.env);
    expect(isCapturing()).toBe(true);
  });

  it("a resume() rejection is surfaced (console.warn) but not fatal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = makeHarness();
    h.ctx.resume.mockRejectedValue(new Error("gesture required"));
    h.ctx.state = "suspended"; // stays suspended
    await startCapture(vi.fn(), h.env);
    expect(warn).toHaveBeenCalled();
    // capture still set up (resume failure is non-fatal on its own)
    expect(isCapturing()).toBe(true);
  });

  it("warns when the context is STILL suspended after resume (no-audio hint)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = makeHarness();
    // resume resolves but the context refuses to leave 'suspended'.
    h.ctx.resume.mockResolvedValue(undefined);
    await startCapture(vi.fn(), h.env);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("still suspended"))).toBe(
      true,
    );
  });
});

// ── the real default env factory ─────────────────────────────────────────────
describe("defaultCaptureEnv", () => {
  it("returns the four capture primitives", () => {
    const env = defaultCaptureEnv();
    expect(env).toHaveProperty("getUserMedia");
    expect(env).toHaveProperty("createContext");
    expect(env).toHaveProperty("createNode");
    expect(env).toHaveProperty("createObjectURL");
  });

  it("leaves getUserMedia undefined when navigator.mediaDevices is unavailable", () => {
    // In the node test env there is no navigator.mediaDevices → unsupported path.
    const env = defaultCaptureEnv();
    expect(env.getUserMedia).toBeUndefined();
  });
});

// ── error mapping ────────────────────────────────────────────────────────────
describe("startCapture — error mapping (nothing swallowed)", () => {
  it("permission denial → 'denied'", async () => {
    for (const name of ["NotAllowedError", "SecurityError", "PermissionDeniedError"]) {
      _resetForTest();
      const h = makeHarness({
        getUserMedia: vi.fn(async () => {
          throw new DOMException("denied", name);
        }),
      });
      await expect(startCapture(vi.fn(), h.env)).rejects.toMatchObject({ kind: "denied" });
    }
  });

  it("a non-permission getUserMedia error → 'failed'", async () => {
    const h = makeHarness({
      getUserMedia: vi.fn(async () => {
        throw new DOMException("device busy", "NotReadableError");
      }),
    });
    await expect(startCapture(vi.fn(), h.env)).rejects.toMatchObject({ kind: "failed" });
  });

  it("missing getUserMedia → 'unsupported'", async () => {
    const h = makeHarness({ getUserMedia: undefined });
    await expect(startCapture(vi.fn(), h.env)).rejects.toMatchObject({
      kind: "unsupported",
    });
  });

  it("missing createContext → 'unsupported'", async () => {
    const h = makeHarness({ createContext: undefined });
    await expect(startCapture(vi.fn(), h.env)).rejects.toMatchObject({
      kind: "unsupported",
    });
  });

  it("a graph-setup failure → 'failed', releases the mic, closes the ctx, RETHROWS", async () => {
    const h = makeHarness();
    h.ctx.audioWorklet.addModule.mockRejectedValue(new Error("addModule blew up"));
    await expect(startCapture(vi.fn(), h.env)).rejects.toBeInstanceOf(MicCaptureException);
    // mic released + context torn down (not leaked)
    expect(h.track.stop).toHaveBeenCalledTimes(1);
    expect(h.ctx.close).toHaveBeenCalledTimes(1);
    expect(isCapturing()).toBe(false);
  });

  it("the thrown error is a MicCaptureException carrying the kind", async () => {
    const h = makeHarness({
      getUserMedia: vi.fn(async () => {
        throw new DOMException("no", "NotAllowedError");
      }),
    });
    await expect(startCapture(vi.fn(), h.env)).rejects.toBeInstanceOf(MicCaptureException);
  });
});

// ── stopCapture ──────────────────────────────────────────────────────────────
describe("stopCapture", () => {
  it("tears down the graph and releases the mic", async () => {
    const h = makeHarness();
    await startCapture(vi.fn(), h.env);
    stopCapture();
    expect(h.node.port.onmessage).toBeNull();
    expect(h.source.disconnect).toHaveBeenCalledTimes(1);
    expect(h.node.disconnect).toHaveBeenCalledTimes(1);
    expect(h.track.stop).toHaveBeenCalledTimes(1);
    expect(h.ctx.close).toHaveBeenCalledTimes(1);
    expect(isCapturing()).toBe(false);
  });

  it("is a safe no-op when not capturing", () => {
    expect(() => stopCapture()).not.toThrow();
  });

  it("a teardown error is surfaced (console.warn), not swallowed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = makeHarness();
    await startCapture(vi.fn(), h.env);
    (h.node.disconnect as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("teardown boom");
    });
    stopCapture();
    expect(warn).toHaveBeenCalled();
    expect(isCapturing()).toBe(false); // still cleared
  });
});
