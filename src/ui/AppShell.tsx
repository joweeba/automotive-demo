import { Viewer } from "../viewer/Viewer";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { CameraViewTabs } from "./CameraViewTabs";
import { MusicPlayer } from "./MusicPlayer";
import { AgentFab } from "./AgentFab";
import { AgentPanel } from "./agent/AgentPanel";
import { ActiveFeaturesPanel } from "./ActiveFeaturesPanel";
import { SignalIndicators } from "./agent/SignalIndicators";
import { useAgent } from "../agent/agentStore";

// Canvas background — the 3D viewport renders transparently on top of this.
const CANVAS_BG =
  "linear-gradient(180deg, var(--sidebar-background) -21.71%, var(--muted) 100%)";

// Top scrim — keeps the title + camera controls legible when bright content
// (e.g. cabin view) reaches the top edge. Opaque at the top, fading to nothing
// just below the title row.
const TOP_SCRIM =
  "linear-gradient(180deg, var(--sidebar-background) 0%, transparent 100%)";

// Footprint reserved on the right for the floating panel(s). Base = one 500px panel
// + 20px inset each side. When the agent chat is open it slides in beside the config
// panel (pushing it left), so two panels + the gap are reserved. The full-bleed canvas
// renders behind them and the camera shears so the car stays composed to their left.
const PANEL_FOOTPRINT = 540;
const PANEL_FOOTPRINT_CHAT = 860; // 20 + 400 + 20(gap) + 400 + 20 — both panels narrow to 400px

/**
 * Base app layout (Figma frame 123:1004): a full-bleed transparent 3D viewport
 * that spans the whole window — so the car slides *behind* the floating config
 * panel instead of being clipped at its edge — with the overlays (title left,
 * camera-view switcher right, centered music player, agent FAB) confined to the
 * viewport area left of the panel, and the Tidal panel floating on top (20px inset).
 */
export function AppShell() {
  const chatOpen = useAgent((s) => s.open);
  const footprint = chatOpen ? PANEL_FOOTPRINT_CHAT : PANEL_FOOTPRINT;
  return (
    <div
      className="relative h-full w-full overflow-hidden text-foreground"
      style={{ background: CANVAS_BG }}
    >
      {/* Full-bleed 3D viewport, behind everything. Pull the camera back a touch when
          both panels are open so the whole car stays easy to see in the tighter space. */}
      <div className="absolute inset-0">
        <Viewer padRight={footprint} zoom={chatOpen ? 1.25 : 1} />
      </div>

      {/* Overlay layer over the visible viewport. Its right edge is pulled to the
          panel's visible left edge (footprint − 20px inset) so the top-right View tabs
          and the bottom-right FAB sit close to the panel rather than far out in the gap.
          pointer-events-none so canvas drag/zoom passes through the gaps. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 transition-[right] duration-300 ease-out"
        style={{ right: footprint - 20 }}
      >
        {/* Legibility scrim behind the top overlays. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[140px]"
          style={{ background: TOP_SCRIM }}
        />

        <Header />

        {/* Front-end signal indicators (VAD / wake / listening / PTT / barge-in): a row of
            little green lights, top-center, that flash on each momentary signal and fade. */}
        <div className="absolute left-1/2 top-5 -translate-x-1/2">
          <SignalIndicators />
        </div>

        {/* Active-features overlay: the generic `feature.*` channel (long-tail grounded
            commands with no dedicated 3D affordance). Shows itself only when non-empty. */}
        <div className="absolute left-5 top-[120px]">
          <ActiveFeaturesPanel />
        </div>

        {/* Camera-view switcher floats over the viewport in the base layout; it docks
            into the config panel top while the agent chat is open. */}
        {!chatOpen && (
          <div className="pointer-events-auto absolute right-5 top-5">
            <CameraViewTabs />
          </div>
        )}

        <div className="pointer-events-auto absolute bottom-6 left-1/2 w-[560px] max-w-[calc(100%-3rem)] -translate-x-1/2">
          <MusicPlayer />
        </div>

        {!chatOpen && (
          <div className="pointer-events-auto absolute bottom-6 right-5">
            <AgentFab />
          </div>
        )}
      </div>

      {/* Floating right panel(s), 20px inset. The config Sidebar always sits here; the
          agent chat slides in to its right (pushing it left) when open. */}
      <div className="absolute right-0 top-0 flex h-full gap-5 p-5">
        <Sidebar showCameraView={chatOpen} compact={chatOpen} />
        {chatOpen && (
          <div className="agent-slide-in">
            <AgentPanel compact />
          </div>
        )}
      </div>
    </div>
  );
}
