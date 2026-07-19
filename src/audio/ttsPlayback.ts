// ---------------------------------------------------------------------------
// ttsPlayback — receive + play the assistant's spoken-reply PCM streamed over the
// emulator's `audio_out` event (base64 little-endian PCM16, 24 kHz per the TTS
// contract). One event = one frame; frames play back-to-back until the terminal
// `final:true` frame closes the utterance.
//
// The real OEM TTS is not integrated yet (the Synthesizer seam is a stub), so today
// the emulator only drives this behind `--tts-audio-demo`. But the full RECEIVE +
// DECODE + PLAYBACK plumbing exists and is unit-tested now, so it works the instant
// real TTS PCM arrives. The decode helpers are pure (unit-tested); the actual Web
// Audio scheduling is guarded (no-op without an AudioContext, e.g. vitest node) and
// the frame sink is INJECTABLE so a test can assert routing without real audio.
// ---------------------------------------------------------------------------

/** One `audio_out` frame off the wire. */
export interface AudioOutFrame {
  format?: string;
  rate?: number;
  seq?: number;
  final?: boolean;
  /** base64 of little-endian PCM16 (empty on the terminal frame). */
  pcm?: string;
}

/** Decode base64 to raw bytes (browser `atob`; also present in the vitest node env). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decode a base64 little-endian PCM16 payload to signed 16-bit samples. */
export function decodePcm16(b64: string): Int16Array {
  const bytes = base64ToBytes(b64);
  const n = bytes.length >> 1; // drop a torn trailing byte, if any
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const lo = bytes[2 * i];
    const hi = bytes[2 * i + 1];
    out[i] = ((hi << 8) | lo) << 16 >> 16; // combine LE, then sign-extend to i16
  }
  return out;
}

/** Normalize PCM16 samples to Web Audio's Float32 [-1, 1) range. */
export function pcm16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

/** Schedules decoded `audio_out` frames onto a Web Audio context, gaplessly. Guarded:
 *  where no AudioContext exists (tests/SSR) it decodes but skips scheduling. */
class WebAudioSink {
  private ctx: AudioContext | null = null;
  private nextStart = 0;

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctx =
      (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    return this.ctx;
  }

  play(frame: AudioOutFrame): void {
    if (frame.final || !frame.pcm) {
      // Terminal marker: reset scheduling so the next utterance starts fresh.
      this.nextStart = 0;
      return;
    }
    const f32 = pcm16ToFloat32(decodePcm16(frame.pcm)); // decode always (exercised in tests)
    const ctx = this.context();
    if (!ctx || f32.length === 0) return;
    const rate = frame.rate ?? 24000;
    const buffer = ctx.createBuffer(1, f32.length, rate);
    buffer.getChannelData(0).set(f32);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const start = Math.max(ctx.currentTime, this.nextStart);
    src.start(start);
    this.nextStart = start + buffer.duration;
  }
}

type FrameSink = (frame: AudioOutFrame) => void;

const webAudioSink = new WebAudioSink();
let sink: FrameSink = (f) => webAudioSink.play(f);

/** Override the audio-out sink (tests inject a spy; `null` restores Web Audio). */
export function setAudioOutSink(s: FrameSink | null): void {
  sink = s ?? ((f) => webAudioSink.play(f));
}

/** Handle one `audio_out` frame: route it to the sink (decode + play). Never throws. */
export function handleAudioOut(frame: AudioOutFrame): void {
  try {
    sink(frame);
  } catch {
    /* playback is best-effort — never break the render loop */
  }
}
