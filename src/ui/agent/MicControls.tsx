import { useAgent } from "../../agent/agentStore";
import { toggleContinuousMic, pttDown, pttUp } from "../../agent/micStreaming";
import { isSendable } from "../../agent/connection";
import { Mic, MicOff } from "../icons";

// ---------------------------------------------------------------------------
// MicControls — the two REAL browser-mic controls that stream PCM16 to the
// emulator over the WebSocket (distinct from the header's simulated mic-mute).
//
//   • Continuous toggle — DEFAULT OFF. On → mic_start + worklet stream; off →
//     mic_stop. A pulsing red dot marks that audio is going out (privacy-visible).
//   • Push-to-talk — momentary hold button. pointerdown → ptt_down + stream;
//     pointerup / pointercancel / pointerleave → ptt_up + stop. Uses pointer
//     capture so a release OUTSIDE the button still stops the stream.
//
// Nothing auto-starts; the mic is only live while the toggle is on or PTT held.
// A denied permission surfaces a clear inline state instead of wedging.
// ---------------------------------------------------------------------------

export function MicControls() {
  const streaming = useAgent((s) => s.micStreaming);
  const ptt = useAgent((s) => s.pttActive);
  const permission = useAgent((s) => s.micPermission);
  const connection = useAgent((s) => s.connection);
  const denied = permission === "denied" || permission === "error";

  // The core UX fix: the mic can ONLY *start* streaming into an OPEN socket. When
  // not connected, disable STARTING a stream so it is impossible to send into a
  // closed socket (the old silent failure). But NEVER disable a control that is
  // currently active — otherwise a mid-stream disconnect would remove the "off"
  // affordance and trap the live mic on (a stuck-state + privacy bug). So an
  // active toggle / held PTT stays operable so the user can always stop it.
  const connected = isSendable(connection);
  const toggleDisabled = !connected && !streaming;
  const pttDisabled = !connected && !ptt;
  const cls = (d: boolean) => (d ? "cursor-not-allowed opacity-40" : "");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/* Continuous-mic toggle */}
        <button
          type="button"
          onClick={toggleContinuousMic}
          disabled={toggleDisabled}
          aria-pressed={streaming}
          aria-disabled={toggleDisabled}
          aria-label={streaming ? "Stop continuous microphone" : "Start continuous microphone"}
          className={`flex flex-1 items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
            streaming
              ? "border-transparent bg-[var(--agent-accent)] text-white"
              : "border-input bg-secondary text-foreground hover:bg-secondary/80"
          } ${cls(toggleDisabled)}`}
        >
          {streaming ? (
            <span className="mic-rec-dot inline-block h-2.5 w-2.5 rounded-full bg-white" aria-hidden />
          ) : (
            <Mic size={16} />
          )}
          {streaming ? "Streaming…" : "Continuous mic"}
        </button>

        {/* Push-to-talk (hold) */}
        <button
          type="button"
          aria-label="Push to talk (hold)"
          aria-pressed={ptt}
          aria-disabled={pttDisabled}
          disabled={pttDisabled}
          onPointerDown={(e) => {
            if (!connected) return; // can't START a stream when not connected
            // Capture so pointerup fires here even if released outside the button.
            e.currentTarget.setPointerCapture?.(e.pointerId);
            void pttDown();
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            pttUp();
          }}
          onPointerCancel={pttUp}
          onPointerLeave={pttUp}
          onContextMenu={(e) => e.preventDefault()}
          className={`flex select-none items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
            ptt
              ? "border-transparent bg-status-error text-white"
              : "border-input bg-secondary text-foreground hover:bg-secondary/80"
          } ${cls(pttDisabled)}`}
        >
          <Mic size={16} />
          {ptt ? "Release to send" : "Hold to talk"}
        </button>
      </div>

      {/* Not-connected reason — makes the disabled state understandable. When a
          stream is still active during a drop, the control stays enabled so it can
          be stopped, and we say so. */}
      {!connected && (
        <div className="flex items-center gap-2 rounded-md bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          <MicOff size={14} />
          {streaming || ptt
            ? "Connection lost — audio isn't being sent. Stop to release the mic."
            : "Not connected — connect to an emulator to stream the microphone."}
        </div>
      )}

      {denied && (
        <div className="flex items-center gap-2 rounded-md bg-status-error/10 px-3 py-2 text-xs text-status-error">
          <MicOff size={14} />
          {permission === "denied"
            ? "Microphone blocked — allow mic access in your browser to stream."
            : "Microphone unavailable in this environment."}
        </div>
      )}
    </div>
  );
}
