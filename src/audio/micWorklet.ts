// ---------------------------------------------------------------------------
// micWorklet — the AudioWorklet processor that captures mic audio and emits
// 16 kHz PCM16 little-endian frames.
//
// ScriptProcessorNode is deprecated; an AudioWorklet runs the capture on the
// audio render thread. The processor buffers incoming Float32 render quanta into
// ~frame-sized chunks, resamples them to 16 kHz, converts to PCM16 LE, and posts
// each frame's ArrayBuffer to the main thread (transferred, zero-copy). The main
// thread (see ./micCapture) forwards it to bmwRenderer.sendAudio.
//
// The resample + int16 conversion is the SAME code as src/audio/pcm.ts — we
// embed those functions verbatim via Function.prototype.toString() so the wire
// format has a single tested source of truth (the worklet global scope can't
// import app modules). `sampleRate` is a global in AudioWorkletGlobalScope.
// ---------------------------------------------------------------------------

import { downsampleTo16k, floatToPcm16, TARGET_SAMPLE_RATE } from "./pcm";

/** Registered processor name (used by AudioWorkletNode). */
export const MIC_WORKLET_NAME = "mic-capture";

// ~32 ms frames at 16 kHz = 512 samples out. We accumulate input samples until
// we have enough to emit one output frame, so ~512 * (inputRate/16000) input
// samples per posted frame (≈1536 at 48 kHz). Keeps frames in the 20–40 ms band.
const OUTPUT_FRAME_SAMPLES = 512;

// The processor body. Written as a plain function whose source is stringified;
// the two pure helpers are prepended so it can call them by name at runtime.
const processorBody = /* js */ `
class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._inRate = sampleRate;
    // Emit an output frame once we have this many INPUT samples.
    const opts = (options && options.processorOptions) || {};
    this._targetRate = opts.targetRate || ${TARGET_SAMPLE_RATE};
    this._outFrame = opts.outputFrameSamples || ${OUTPUT_FRAME_SAMPLES};
    this._inPerFrame = Math.max(1, Math.round(this._outFrame * (this._inRate / this._targetRate)));
    this._buf = new Float32Array(0);
  }

  _append(chunk) {
    const next = new Float32Array(this._buf.length + chunk.length);
    next.set(this._buf, 0);
    next.set(chunk, this._buf.length);
    this._buf = next;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Mono: take channel 0 (getUserMedia({audio:true}) is typically mono, and
      // if not, channel 0 is a faithful mono take for ASR purposes).
      this._append(input[0]);
      while (this._buf.length >= this._inPerFrame) {
        const chunk = this._buf.subarray(0, this._inPerFrame);
        this._buf = this._buf.slice(this._inPerFrame);
        const pcm = floatToPcm16(downsampleTo16k(chunk, this._inRate, this._targetRate));
        // Transfer the buffer to the main thread (zero-copy).
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
      }
    }
    return true; // keep the processor alive
  }
}
registerProcessor(${JSON.stringify(MIC_WORKLET_NAME)}, MicCaptureProcessor);
`;

/**
 * The full worklet module source: the two pure conversion functions (embedded
 * verbatim so the worklet and the unit-tested code are identical) plus the
 * processor. Loaded via a Blob URL by micCapture.
 *
 * The functions are bound to explicit const names the processor calls, so a
 * production minifier renaming the source functions can't break the worklet's
 * call sites (fn.toString() reflects the minified name).
 */
export function buildWorkletSource(): string {
  return [
    `const downsampleTo16k = ${downsampleTo16k.toString()};`,
    `const floatToPcm16 = ${floatToPcm16.toString()};`,
    processorBody,
  ].join("\n");
}
