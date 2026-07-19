// ---------------------------------------------------------------------------
// cues — a short acknowledgement CHIME played on the emulator's `audio_cue` event
// (the assistant heard the wake word / started listening / a PTT press). Self-
// contained Web Audio (an oscillator envelope) — no bundled asset, no network.
//
// The player is INJECTABLE (`setCuePlayer`) so tests can assert a cue fired without
// a real AudioContext, and the default gracefully no-ops where Web Audio is absent
// (SSR / vitest node env). `audio_cue` is distinct from `audio_out` (the spoken-reply
// waveform) — this is just a brief tone.
// ---------------------------------------------------------------------------

/** What triggered the cue; drives a small pitch difference per reason. */
export type CueReason = "wake_word" | "listening" | "ptt" | string;

type CuePlayer = (reason: CueReason) => void;

/** Base pitch (Hz) per reason, so the three acks are audibly distinct. */
const CUE_HZ: Record<string, number> = {
  wake_word: 880, // A5 — the brightest, "I heard you"
  listening: 660, // E5
  ptt: 523, // C5
};

// A single reused AudioContext (created lazily on the first chime) rather than one per
// tone: back-to-back cues (e.g. wake_word then listening) would otherwise pile up
// concurrent contexts, and some browsers cap those (Safari) — `new AudioContext()` then
// throws. Reusing one matches the ttsPlayback sink and avoids audio-hardware churn.
let sharedCtx: AudioContext | null = null;

function chimeContext(): AudioContext | null {
  if (sharedCtx) return sharedCtx;
  const Ctx =
    (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null; // no Web Audio (node/tests/SSR)
  sharedCtx = new Ctx();
  return sharedCtx;
}

function webAudioChime(reason: CueReason): void {
  const ctx = chimeContext();
  if (!ctx) return; // silently skip where Web Audio is unavailable
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = CUE_HZ[reason] ?? 700;
  // A short pluck: quick attack, ~180ms exponential decay. The nodes are one-shot
  // (garbage-collected after `onended`); the shared context stays open for reuse.
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

let player: CuePlayer = webAudioChime;

/** Override the chime player (tests inject a spy; `null` restores the Web Audio default). */
export function setCuePlayer(p: CuePlayer | null): void {
  player = p ?? webAudioChime;
}

/** Play the acknowledgement chime for `reason`. Never throws (a demo affordance). */
export function playChime(reason: CueReason): void {
  try {
    player(reason);
  } catch {
    /* audio is a best-effort affordance — never break the render loop */
  }
}
