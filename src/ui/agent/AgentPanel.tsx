import { closeChat, toggleMic, toggleConsole, useAgent } from "../../agent/agentStore";
import { PANEL_STYLE } from "../panelStyle";
import { PanelClose, Mic, MicOff, Terminal } from "../icons";
import { AgentMessages } from "./AgentMessages";
import { AgentInput } from "./AgentInput";
import { AgentStatus } from "./AgentStatus";
import { AgentConsole } from "./AgentConsole";
import { MicControls } from "./MicControls";
import { ConnectionStatus } from "./ConnectionStatus";

/** A small header toggle button (mic mute / console). */
function HeaderButton({
  onClick,
  label,
  active,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const tone = danger
    ? "text-status-error hover:text-status-error"
    : active
      ? "bg-secondary text-foreground"
      : "text-muted-foreground hover:text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-secondary ${tone}`}
    >
      {children}
    </button>
  );
}

/**
 * The "Liquid agent" chat panel — occupies the same 500px right slot as the config
 * Sidebar (they swap via the Agent FAB / this header's close button). See Figma 123:2751.
 * Header (close · title · mic-mute · console) · messages (+ voice-status modal overlay) ·
 * collapsible console log · composer.
 */
export function AgentPanel({ compact = false }: { compact?: boolean }) {
  const micMuted = useAgent((s) => s.micMuted);
  const consoleOpen = useAgent((s) => s.consoleOpen);

  return (
    <aside
      style={PANEL_STYLE}
      className={`flex h-full flex-col overflow-hidden shadow-overlay ${compact ? "w-[400px]" : "w-[500px]"}`}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-sidebar-border px-3 py-4">
        <button
          type="button"
          onClick={closeChat}
          aria-label="Close agent"
          className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <PanelClose size={18} />
        </button>
        <div className="h-6 w-px bg-sidebar-border" />
        <span className="text-base font-medium text-foreground">Liquid agent</span>

        <div className="ml-auto flex items-center gap-1">
          <HeaderButton
            onClick={toggleMic}
            label={micMuted ? "Unmute microphone" : "Mute microphone"}
            danger={micMuted}
          >
            {micMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </HeaderButton>
          <HeaderButton onClick={toggleConsole} label="Toggle console" active={consoleOpen}>
            <Terminal size={18} />
          </HeaderButton>
        </div>
      </div>

      {/* Messages + voice-status overlay */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <AgentMessages />
        <AgentStatus />
      </div>

      {/* Collapsible console log */}
      <AgentConsole />

      {/* Composer */}
      <div className="flex shrink-0 flex-col gap-3 p-6">
        <ConnectionStatus />
        <MicControls />
        <AgentInput />
      </div>
    </aside>
  );
}
