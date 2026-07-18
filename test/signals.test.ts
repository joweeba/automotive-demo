import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ingest } from "../src/agent/bmwRenderer";
import {
  flashSignal,
  getSignalState,
  resetSignals,
  SIGNAL_DECAY_MS,
  SIGNAL_KINDS,
  type SignalKind,
} from "../src/agent/signalStore";

// The front-end signal indicators: a momentary green light per signal that lights on
// the `activation` event and DECAYS after ~1s. Time-driven, so these use fake timers.

const activation = (kind: string, extra: Record<string, unknown> = {}) => ({
  v: 2,
  event: "activation",
  kind,
  ...extra,
});

describe("signalStore — indicator light + timed decay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSignals();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lights on flash and decays after ~1s", () => {
    flashSignal("vad", "on");
    expect(getSignalState().vad).toEqual({ lit: true, detail: "on" });
    // Still lit just before the decay window closes …
    vi.advanceTimersByTime(SIGNAL_DECAY_MS - 1);
    expect(getSignalState().vad.lit).toBe(true);
    // … and cleared once it elapses.
    vi.advanceTimersByTime(1);
    expect(getSignalState().vad.lit).toBe(false);
  });

  it("a re-flash within the window cancels the earlier decay (no flicker)", () => {
    flashSignal("ptt");
    vi.advanceTimersByTime(600);
    flashSignal("ptt"); // re-flash resets the window
    vi.advanceTimersByTime(600); // 1200ms since the first flash, 600ms since the second
    expect(getSignalState().ptt.lit).toBe(true);
    vi.advanceTimersByTime(SIGNAL_DECAY_MS - 600); // close the second window
    expect(getSignalState().ptt.lit).toBe(false);
  });

  it("each signal kind decays independently", () => {
    flashSignal("wake_word");
    vi.advanceTimersByTime(500);
    flashSignal("barge_in");
    vi.advanceTimersByTime(SIGNAL_DECAY_MS - 500); // wake_word window closes, barge_in's does not
    expect(getSignalState().wake_word.lit).toBe(false);
    expect(getSignalState().barge_in.lit).toBe(true);
  });
});

describe("bmwRenderer — activation events drive the indicators", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSignals();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lights the right indicator for each signal kind", () => {
    const cases: Array<[string, SignalKind]> = [
      ["vad", "vad"],
      ["wake_word", "wake_word"],
      ["listening", "listening"],
      ["ptt", "ptt"],
      ["barge_in", "barge_in"],
    ];
    for (const [kind, indicator] of cases) {
      resetSignals();
      ingest(activation(kind, { active: true }));
      expect(getSignalState()[indicator].lit, `${kind} lights ${indicator}`).toBe(true);
    }
  });

  it("carries the active phase edge as on/off detail", () => {
    ingest(activation("vad", { active: true }));
    expect(getSignalState().vad.detail).toBe("on");
    resetSignals();
    ingest(activation("vad", { active: false }));
    expect(getSignalState().vad.detail).toBe("off");
  });

  it("carries the barge-in phase as the indicator detail", () => {
    ingest(activation("barge_in", { detail: "ducked" }));
    expect(getSignalState().barge_in).toEqual({ lit: true, detail: "ducked" });
  });

  it("does NOT light an indicator for the non-signal kinds (endpoint)", () => {
    ingest(activation("endpoint", { detail: "mic:320 samples" }));
    expect(SIGNAL_KINDS.every((k) => !getSignalState()[k].lit)).toBe(true);
  });

  it("an unknown activation kind is handled gracefully (no light, no throw)", () => {
    expect(() => ingest(activation("teleport"))).not.toThrow();
    expect(SIGNAL_KINDS.every((k) => !getSignalState()[k].lit)).toBe(true);
  });
});
