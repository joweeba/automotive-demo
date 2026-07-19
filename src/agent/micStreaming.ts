// ---------------------------------------------------------------------------
// micStreaming — orchestrates the two mic controls (continuous toggle +
// push-to-talk) over the emulator WebSocket.
//
// Ties the pure pieces together: micCapture (getUserMedia + worklet) produces
// PCM16 frames; bmwRenderer.sendAudio ships them as binary; sendControl frames
// bracket a stream (mic_start/mic_stop for the toggle, ptt_down/ptt_up for PTT).
// agentStore holds the UI-visible state (micStreaming / pttActive / permission).
//
// One physical mic → one logical stream at a time. The two controls are
// mutually exclusive at runtime (a second activation while one is live is
// ignored); this keeps the wire unambiguous — binary frames are only ever sent
// between a single matching start/stop pair.
// ---------------------------------------------------------------------------

import { startCapture, stopCapture, MicCaptureException } from "../audio/micCapture";
import { sendControl, sendAudio, type MicControlCmd } from "./bmwRenderer";
import {
  setMicStreaming,
  setPttActive,
  setMicPermission,
  pushConsole,
  getAgentState,
} from "./agentStore";

type Mode = "continuous" | "ptt";
let active: Mode | null = null;

/** Start capture and emit the start control frame. Returns true on success. */
async function begin(mode: Mode, startCmd: MicControlCmd): Promise<boolean> {
  if (active) return false; // another mode owns the mic
  try {
    await startCapture(sendAudio);
    // Control frame first: WS preserves send order, and sendControl runs before
    // any queued worklet frame reaches sendAudio — so mic_start precedes audio.
    active = mode;
    setMicPermission("granted");
    sendControl(startCmd);
    return true;
  } catch (err) {
    const kind = err instanceof MicCaptureException ? err.kind : "failed";
    setMicPermission(kind === "denied" ? "denied" : "error");
    pushConsole("error", `mic: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Emit the stop control frame and tear down capture. */
function end(mode: Mode, stopCmd: MicControlCmd): void {
  if (active !== mode) return;
  stopCapture(); // stop frames first, then close the stream on the wire
  sendControl(stopCmd);
  active = null;
}

/** Continuous-mic toggle. On → mic_start + stream; off → mic_stop. */
export async function toggleContinuousMic(): Promise<void> {
  if (getAgentState().micStreaming) {
    end("continuous", "mic_stop");
    setMicStreaming(false);
    return;
  }
  // Optimistically reflect intent; roll back if the mic can't start.
  setMicStreaming(true);
  const ok = await begin("continuous", "mic_start");
  if (!ok) setMicStreaming(false);
}

/** Push-to-talk press: ptt_down + start streaming. */
export async function pttDown(): Promise<void> {
  if (active) return; // toggle (or an earlier press) already owns the mic
  setPttActive(true);
  const ok = await begin("ptt", "ptt_down");
  if (!ok) setPttActive(false);
}

/** Push-to-talk release: ptt_up + stop. Safe to call when not held. */
export function pttUp(): void {
  if (getAgentState().pttActive) setPttActive(false);
  end("ptt", "ptt_up");
}

/** Test/reset hook — force everything off without touching the socket contract. */
export function _resetForTest(): void {
  active = null;
}
