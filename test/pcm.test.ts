// Unit tests for the pure browser-mic conversion (src/audio/pcm.ts) and the
// mic control-message shape (src/agent/bmwRenderer.buildControlMessage). These
// are the headless-testable heart of the streaming path; getUserMedia and the
// AudioWorklet are exercised in the browser, not here.
import { describe, it, expect } from "vitest";
import { downsampleTo16k, floatToPcm16, pcm16FromFloat32, TARGET_SAMPLE_RATE } from "../src/audio/pcm";
import { buildControlMessage, AUDIO_FORMAT } from "../src/agent/bmwRenderer";
import { buildWorkletSource, MIC_WORKLET_NAME } from "../src/audio/micWorklet";

describe("downsampleTo16k", () => {
  it("48 kHz → 16 kHz yields ~1/3 the samples", () => {
    const input = new Float32Array(4800); // 100 ms @ 48 kHz
    const out = downsampleTo16k(input, 48000);
    expect(out.length).toBe(1600); // 100 ms @ 16 kHz
  });

  it("44.1 kHz → 16 kHz length matches floor(n / ratio)", () => {
    const input = new Float32Array(4410);
    const out = downsampleTo16k(input, 44100);
    expect(out.length).toBe(Math.floor(4410 / (44100 / 16000)));
  });

  it("returns input unchanged when already at/below target (never upsamples)", () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsampleTo16k(input, 16000)).toBe(input);
    expect(downsampleTo16k(input, 8000)).toBe(input);
  });

  it("empty / invalid rate yields an empty buffer", () => {
    expect(downsampleTo16k(new Float32Array(0), 48000).length).toBe(0);
    expect(downsampleTo16k(new Float32Array([1, 2]), 0).length).toBe(0);
  });

  it("linear interpolation preserves a constant signal", () => {
    const input = new Float32Array(3000).fill(0.25);
    const out = downsampleTo16k(input, 48000);
    for (const s of out) expect(s).toBeCloseTo(0.25, 5);
  });
});

describe("floatToPcm16", () => {
  it("maps 0 → 0, +1 → 32767, -1 → -32768 (standard PCM16 mapping)", () => {
    const out = floatToPcm16(new Float32Array([0, 1, -1]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(32767);
    expect(out[2]).toBe(-32768);
  });

  it("clamps out-of-range samples to [-1, 1]", () => {
    const out = floatToPcm16(new Float32Array([2, -2, 1.5, -3]));
    expect(out[0]).toBe(32767);
    expect(out[1]).toBe(-32768);
    expect(out[2]).toBe(32767);
    expect(out[3]).toBe(-32768);
  });

  it("emits LITTLE-ENDIAN bytes regardless of host", () => {
    // Choose a sample whose int16 has distinct low/high bytes: 0x0102 = 258.
    const target = 258;
    const out = floatToPcm16(new Float32Array([target / 32767]));
    const bytes = new Uint8Array(out.buffer);
    expect(bytes[0]).toBe(0x02); // low byte first == little-endian
    expect(bytes[1]).toBe(0x01);
    // Reading the buffer as explicit LE recovers the value.
    const dv = new DataView(out.buffer);
    expect(dv.getInt16(0, true)).toBe(target);
  });

  it("produces 2 bytes per sample", () => {
    const out = floatToPcm16(new Float32Array(320));
    expect(out.buffer.byteLength).toBe(640);
  });
});

describe("pcm16FromFloat32 (resample + convert)", () => {
  it("48 kHz float frame → 16 kHz PCM16 of the expected length", () => {
    const out = pcm16FromFloat32(new Float32Array(1536).fill(1), 48000);
    expect(out.length).toBe(512);
    for (const s of out) expect(s).toBe(32767); // clamped/scaled max
  });

  it("uses a 16 kHz default target", () => {
    expect(TARGET_SAMPLE_RATE).toBe(16000);
  });
});

describe("buildControlMessage (wire shape)", () => {
  it("mic_start carries v:2, in, and the audio-format descriptor", () => {
    expect(buildControlMessage("mic_start")).toEqual({
      v: 2,
      in: "mic_start",
      sample_rate: 16000,
      format: "pcm16le",
      channels: 1,
    });
  });

  it("ptt_down carries the same audio-format descriptor", () => {
    expect(buildControlMessage("ptt_down")).toEqual({
      v: 2,
      in: "ptt_down",
      ...AUDIO_FORMAT,
    });
  });

  it("mic_stop and ptt_up are bare {v, in} (no format)", () => {
    expect(buildControlMessage("mic_stop")).toEqual({ v: 2, in: "mic_stop" });
    expect(buildControlMessage("ptt_up")).toEqual({ v: 2, in: "ptt_up" });
  });

  it("serializes to the exact pinned JSON text", () => {
    expect(JSON.stringify(buildControlMessage("mic_start"))).toBe(
      '{"v":2,"in":"mic_start","sample_rate":16000,"format":"pcm16le","channels":1}',
    );
    expect(JSON.stringify(buildControlMessage("mic_stop"))).toBe('{"v":2,"in":"mic_stop"}');
  });
});

describe("buildWorkletSource (embedding technique)", () => {
  const src = buildWorkletSource();

  it("binds the conversion fns to the exact names the processor calls", () => {
    // Guards against a minifier renaming the source fns and breaking the worklet.
    expect(src).toContain("const downsampleTo16k =");
    expect(src).toContain("const floatToPcm16 =");
    expect(src).toContain("floatToPcm16(downsampleTo16k(");
  });

  it(`registers the processor as "${MIC_WORKLET_NAME}"`, () => {
    expect(src).toContain(`registerProcessor("${MIC_WORKLET_NAME}"`);
    expect(src).toContain("extends AudioWorkletProcessor");
  });
});
