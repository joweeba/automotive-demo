import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ingest } from "../src/agent/bmwRenderer";
import { setCuePlayer, playChime } from "../src/audio/cues";
import {
  setAudioOutSink,
  handleAudioOut,
  decodePcm16,
  pcm16ToFloat32,
  base64ToBytes,
  type AudioOutFrame,
} from "../src/audio/ttsPlayback";

// Chime (audio_cue) + spoken-reply playback (audio_out). The Web Audio players are
// injectable so we assert routing + decoding without a real AudioContext.

describe("cues — audio_cue chime", () => {
  afterEach(() => setCuePlayer(null));

  it("plays a chime with the event's reason", () => {
    const played: string[] = [];
    setCuePlayer((reason) => played.push(reason));
    ingest({ v: 2, event: "audio_cue", kind: "chime", reason: "wake_word" });
    ingest({ v: 2, event: "audio_cue", kind: "chime", reason: "ptt" });
    expect(played).toEqual(["wake_word", "ptt"]);
  });

  it("never throws when the player throws (best-effort affordance)", () => {
    setCuePlayer(() => {
      throw new Error("no audio device");
    });
    expect(() => playChime("listening")).not.toThrow();
  });

  it("no-ops gracefully with no Web Audio available (default player, node env)", () => {
    // Default player: globalThis has no AudioContext in the vitest node env → silent.
    setCuePlayer(null);
    expect(() => ingest({ v: 2, event: "audio_cue", reason: "wake_word" })).not.toThrow();
  });
});

describe("ttsPlayback — decode helpers", () => {
  it("decodes base64 little-endian PCM16 (inverse of the emulator's encoding)", () => {
    // 0x0100 LE = 256, 0xFFFF LE = -1 → bytes [00 01 FF FF] → base64 "AAH//w==".
    const pcm = decodePcm16("AAH//w==");
    expect(Array.from(pcm)).toEqual([256, -1]);
  });

  it("drops a torn trailing byte instead of throwing", () => {
    // 3 bytes → one whole sample, the odd byte dropped.
    const b64 = btoa(String.fromCharCode(0x00, 0x01, 0x7f));
    expect(Array.from(decodePcm16(b64))).toEqual([256]);
  });

  it("normalizes PCM16 to Float32 [-1, 1)", () => {
    const f = pcm16ToFloat32(Int16Array.from([0, 16384, -32768]));
    expect(f[0]).toBeCloseTo(0);
    expect(f[1]).toBeCloseTo(0.5);
    expect(f[2]).toBeCloseTo(-1);
  });

  it("base64ToBytes round-trips raw bytes", () => {
    expect(Array.from(base64ToBytes("AAH//w=="))).toEqual([0x00, 0x01, 0xff, 0xff]);
  });
});

describe("ttsPlayback — audio_out routing", () => {
  beforeEach(() => setAudioOutSink(null));
  afterEach(() => setAudioOutSink(null));

  it("routes each audio_out frame to the sink", () => {
    const frames: AudioOutFrame[] = [];
    setAudioOutSink((f) => frames.push(f));
    ingest({ v: 2, event: "audio_out", format: "pcm16", rate: 24000, seq: 0, final: false, pcm: "AAH//w==" });
    ingest({ v: 2, event: "audio_out", format: "pcm16", rate: 24000, seq: 1, final: true, pcm: "" });
    expect(frames).toHaveLength(2);
    expect(frames[0].seq).toBe(0);
    expect(frames[0].pcm).toBe("AAH//w==");
    expect(frames[1].final).toBe(true);
  });

  it("the default sink handles a real PCM frame + terminal frame without throwing (no AudioContext)", () => {
    setAudioOutSink(null); // Web Audio default; node env has no AudioContext → decode-only, no play
    expect(() =>
      handleAudioOut({ format: "pcm16", rate: 24000, seq: 0, final: false, pcm: "AAH//w==" }),
    ).not.toThrow();
    expect(() => handleAudioOut({ format: "pcm16", rate: 24000, seq: 1, final: true, pcm: "" })).not.toThrow();
  });
});
