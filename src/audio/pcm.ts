// ---------------------------------------------------------------------------
// pcm — pure, dependency-free audio conversion for browser mic streaming.
//
// The browser mic delivers mono Float32 samples at the AudioContext rate
// (typically 48 kHz). The emulator's speech-to-execution contract wants a
// whole-utterance stream of **16 kHz, mono, PCM16 little-endian** samples
// (see CLAUDE.md "whole-utterance audio in" + the shared WS protocol).
//
// These two functions do the resample + float→int16 conversion. They are kept
// pure (no Web Audio / DOM deps) so they are unit-testable in a headless node
// env — getUserMedia and the AudioWorklet themselves are not. The AudioWorklet
// processor (see ./micWorklet) runs the SAME algorithm inside the audio thread
// by embedding these functions verbatim via Function.prototype.toString(), so
// there is a single source of truth for the wire format.
//
// IMPORTANT: keep these functions SELF-CONTAINED (no references to module-scope
// helpers, imports, or closures) — they are stringified into the worklet, so a
// reference the worklet global scope can't resolve would break capture.
// ---------------------------------------------------------------------------

/** Target sample rate of the wire format (Hz). */
export const TARGET_SAMPLE_RATE = 16000;

/**
 * Downsample a mono Float32 buffer from `inputRate` to `targetRate` (default
 * 16 kHz) using linear interpolation. Pure; no Web Audio deps.
 *
 * - If `inputRate <= targetRate` (already at/below target), the input is
 *   returned unchanged (we never upsample — the mic is virtually always higher).
 * - Empty input yields an empty buffer.
 */
export function downsampleTo16k(
  input: Float32Array,
  inputRate: number,
  targetRate = 16000,
): Float32Array {
  if (input.length === 0 || !(inputRate > 0)) return new Float32Array(0);
  if (inputRate <= targetRate) return input;
  const ratio = inputRate / targetRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = i0 + 1 < input.length ? i0 + 1 : i0;
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/**
 * Convert mono Float32 samples in [-1, 1] to signed 16-bit PCM, writing bytes
 * in explicit LITTLE-ENDIAN order regardless of host endianness. Values are
 * clamped to [-1, 1] before scaling (asymmetric: negative uses 0x8000, positive
 * 0x7FFF — the standard PCM16 mapping).
 *
 * Returns an Int16Array backed by a little-endian ArrayBuffer, so both the view
 * values (on a little-endian host) and `.buffer` (on ANY host) are correct for
 * sending down the WebSocket.
 */
export function floatToPcm16(input: Float32Array): Int16Array {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    let s = input[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    // Round toward nearest; force little-endian byte order.
    view.setInt16(i * 2, Math.round(val), true);
  }
  return new Int16Array(buffer);
}

/**
 * Convenience: resample a mono Float32 mic buffer straight to 16 kHz PCM16 LE.
 * This is the exact transform the worklet applies per audio frame.
 */
export function pcm16FromFloat32(
  input: Float32Array,
  inputRate: number,
  targetRate = 16000,
): Int16Array {
  return floatToPcm16(downsampleTo16k(input, inputRate, targetRate));
}
