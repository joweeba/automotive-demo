import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// signalStore — the momentary front-end/activation SIGNAL indicators.
//
// The emulator (run with `--emit-signals`) streams `activation` events for the
// front-end signals — `vad`, `wake_word`, `listening`, `ptt` — plus the existing
// `barge_in`. Each is a MOMENTARY pulse: the UI lights a little green indicator on
// arrival and lets it DECAY after ~1s. We model that as a per-kind `lit` flag that
// `flashSignal` raises and a timer lowers ~1s later; the CSS transitions opacity so
// the fall reads as a timed fade (see `.signal-light` in index.css).
//
// A re-flash within the window cancels the pending decay (token check) so a rapid
// burst keeps the light on rather than flickering. Same lightweight store pattern as
// agentStore/vehicleState (getState/subscribe + a `useSignals` hook).
// ---------------------------------------------------------------------------

/** The signal kinds the UI shows as green lights (a superset of the emulator's
 *  `--emit-signals` kinds plus the always-available `barge_in`). */
export type SignalKind = "vad" | "wake_word" | "listening" | "ptt" | "barge_in";

/** Render order + presence of the indicator row. */
export const SIGNAL_KINDS: SignalKind[] = ["vad", "wake_word", "listening", "ptt", "barge_in"];

/** Short human label per indicator. */
export const SIGNAL_LABEL: Record<SignalKind, string> = {
  vad: "VAD",
  wake_word: "Wake",
  listening: "Listening",
  ptt: "PTT",
  barge_in: "Barge-in",
};

/** How long an indicator stays lit before it decays (ms). */
export const SIGNAL_DECAY_MS = 1000;

export interface Indicator {
  /** Whether the light is currently on (CSS fades it out when this flips false). */
  lit: boolean;
  /** Optional per-pulse detail (e.g. `on`/`off` phase, or a barge-in phase name). */
  detail: string;
}

export type SignalState = Record<SignalKind, Indicator>;

function fresh(): SignalState {
  return {
    vad: { lit: false, detail: "" },
    wake_word: { lit: false, detail: "" },
    listening: { lit: false, detail: "" },
    ptt: { lit: false, detail: "" },
    barge_in: { lit: false, detail: "" },
  };
}

let state: SignalState = fresh();
const listeners = new Set<() => void>();
// Per-kind monotonic token so a pending decay only fires if it wasn't superseded by a
// newer flash (a re-flash keeps the light on instead of an early clear).
const tokens: Record<SignalKind, number> = {
  vad: 0,
  wake_word: 0,
  listening: 0,
  ptt: 0,
  barge_in: 0,
};

function emit(): void {
  listeners.forEach((l) => l());
}

function setSig(kind: SignalKind, ind: Indicator): void {
  state = { ...state, [kind]: ind };
  emit();
}

export function getSignalState(): SignalState {
  return state;
}

export function subscribeSignals(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSignals<T>(selector: (s: SignalState) => T): T {
  return useSyncExternalStore(
    subscribeSignals,
    () => selector(state),
    () => selector(state),
  );
}

/** Light `kind`'s indicator now and schedule its ~1s decay. A re-flash within the
 *  window cancels the earlier decay so the light stays on. */
export function flashSignal(kind: SignalKind, detail = ""): void {
  setSig(kind, { lit: true, detail });
  const token = ++tokens[kind];
  setTimeout(() => {
    // Only clear if this flash is still the most recent for the kind.
    if (tokens[kind] === token && state[kind].lit) {
      setSig(kind, { lit: false, detail: "" });
    }
  }, SIGNAL_DECAY_MS);
}

/** Reset all indicators (used by tests + on renderer reset). Tokens are BUMPED, not
 *  zeroed, so any decay `setTimeout` still pending from before the reset is invalidated
 *  (its captured token can never match again) — otherwise a stale timer could fire after
 *  a fresh post-reset flash and clear that light early. Monotonicity is what the token
 *  scheme relies on, so we must never roll the counter back. */
export function resetSignals(): void {
  state = fresh();
  for (const k of SIGNAL_KINDS) tokens[k] += 1;
  emit();
}
