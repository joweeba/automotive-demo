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

function webAudioChime(reason: CueReason): void {
  const Ctx =
    (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return; // no Web Audio (node/tests/SSR) — silently skip
  const ctx = new Ctx();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = CUE_HZ[reason] ?? 700;
  // A short pluck: quick attack, ~180ms exponential decay.
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
  // Free the context shortly after the tone ends (best-effort).
  osc.onended = () => {
    void ctx.close().catch(() => {});
  };
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
