import type { ReactNode } from "react";
import { InteriorSection } from "./sections/InteriorSection";
import {
  ExteriorLightRows,
  WiperRow,
  AccessRows,
} from "./sections/ExteriorSection";
import { CameraViewRow } from "./CameraViewTabs";
import { PANEL_STYLE } from "./panelStyle";

/** A control band: 24px inset from the panel edges / dividers, optional title. */
function Band({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 p-7">
      {title && <h2 className="text-base font-medium text-foreground">{title}</h2>}
      {children}
    </section>
  );
}

function Divider() {
  return <div className="border-t border-sidebar-border" />;
}

/**
 * Right-hand configuration panel: floating, divider-separated bands. 500px on its own;
 * when `compact` (agent chat open) it narrows to 400px so both panels fit (the control
 * columns fill the remaining row width — see `ControlRow`). When `showCameraView` (chat
 * open), the view switcher docks into the panel top — it floats over the viewport otherwise.
 */
export function Sidebar({
  showCameraView = false,
  compact = false,
}: {
  showCameraView?: boolean;
  compact?: boolean;
}) {
  return (
    <aside
      style={PANEL_STYLE}
      className={`flex h-full flex-col overflow-y-auto shadow-overlay ${compact ? "w-[400px]" : "w-[500px]"}`}
    >
      {showCameraView && (
        <>
          <Band>
            <CameraViewRow />
          </Band>
          <Divider />
        </>
      )}
      <Band title="Interior">
        <InteriorSection />
      </Band>
      <Divider />
      <Band title="Exterior">
        <ExteriorLightRows />
      </Band>
      <Divider />
      <Band>
        <WiperRow />
      </Band>
      <Divider />
      <Band>
        <AccessRows />
      </Band>
    </aside>
  );
}
