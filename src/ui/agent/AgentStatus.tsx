import { useAgent, PHASE_LABEL } from "../../agent/agentStore";
import type { AgentPhase } from "../../agent/agentStore";
import { LiquidMark } from "../icons";

/** Animated bar cluster used for Voice-Activity + Speaking states. */
function Waveform({ tone }: { tone: "accent" | "foreground" }) {
  const bars = [0, 1, 2, 3, 4, 5, 6];
  const color = tone === "accent" ? "bg-[var(--agent-accent)]" : "bg-foreground";
  return (
    <div className="flex h-8 items-center gap-1">
      {bars.map((i) => (
        <span
          key={i}
          className={`w-1 rounded-full ${color} agent-wave`}
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  );
}

/** The visual for a given phase. */
function PhaseVisual({ phase }: { phase: Exclude<AgentPhase, "idle"> }) {
  switch (phase) {
    case "wake":
      // Pulsing ring around the Liquid mark.
      return (
        <div className="relative flex h-12 w-12 items-center justify-center">
          <span className="agent-ping absolute inset-0 rounded-full border border-[var(--agent-accent)]" />
          <LiquidMark className="h-6 w-6 text-[var(--agent-accent)]" />
        </div>
      );
    case "voice":
      return <Waveform tone="accent" />;
    case "processing":
      return (
        <div className="flex items-center gap-1.5">
          <span className="agent-dot h-2 w-2 rounded-full bg-foreground" style={{ animationDelay: "0ms" }} />
          <span className="agent-dot h-2 w-2 rounded-full bg-foreground" style={{ animationDelay: "160ms" }} />
          <span className="agent-dot h-2 w-2 rounded-full bg-foreground" style={{ animationDelay: "320ms" }} />
        </div>
      );
    case "speaking":
      return <Waveform tone="foreground" />;
  }
}

/**
 * Voice-status modal. Driven by `window.LiquidCar.agent.setPhase(...)`. Overlays the
 * message area with an animated indicator + label + live transcript whenever the
 * pipeline is doing something (wake word / voice activity / processing / speaking).
 */
export function AgentStatus() {
  const phase = useAgent((s) => s.phase);
  const transcript = useAgent((s) => s.transcript);

  if (phase === "idle") return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 z-10 flex flex-col items-center justify-end gap-4 bg-gradient-to-t from-[var(--sidebar-background)] via-[var(--sidebar-background)]/85 to-transparent p-6 pb-8">
      <div className="agent-status-pop flex flex-col items-center gap-4">
        <PhaseVisual phase={phase} />
        <div className="text-sm font-medium text-foreground">{PHASE_LABEL[phase]}</div>
        {transcript && (
          <p className="max-w-[320px] text-center text-sm italic text-muted-foreground">
            “{transcript}”
          </p>
        )}
      </div>
    </div>
  );
}
