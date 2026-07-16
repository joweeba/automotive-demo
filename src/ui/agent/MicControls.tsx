import { useAgent } from "../../agent/agentStore";
import { toggleContinuousMic, pttDown, pttUp } from "../../agent/micStreaming";
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
  const denied = permission === "denied" || permission === "error";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/* Continuous-mic toggle */}
        <button
          type="button"
          onClick={toggleContinuousMic}
          aria-pressed={streaming}
          aria-label={streaming ? "Stop continuous microphone" : "Start continuous microphone"}
          className={`flex flex-1 items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
            streaming
              ? "border-transparent bg-[var(--agent-accent)] text-white"
              : "border-input bg-secondary text-foreground hover:bg-secondary/80"
          }`}
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
          onPointerDown={(e) => {
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
          }`}
        >
          <Mic size={16} />
          {ptt ? "Release to send" : "Hold to talk"}
        </button>
      </div>

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
