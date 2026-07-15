import { useVehicle } from "../state/vehicleState";
import type { CameraView } from "../state/vehicleState";
import { setCameraView } from "../state/vehicleCommands";
import { SegmentedControl, type SegmentedOption } from "./controls/SegmentedControl";
import { ControlRow } from "./controls/ControlRow";
import { Camera } from "./icons";

// Figma order: 3/4 · Top · Side · Cabin.
const CAMERA_OPTS: SegmentedOption<CameraView>[] = [
  { value: "threeq", label: "3/4" },
  { value: "top", label: "Top" },
  { value: "side", label: "Side" },
  { value: "cabin", label: "Cabin" },
];

/**
 * Camera-view switcher. Floats top-center over the viewport in the base layout;
 * built as a standalone piece so it can dock into the config panel header once
 * the agent chat opens (Pass 3).
 */
export function CameraViewTabs() {
  const view = useVehicle((s) => s.view);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/70 px-3 py-2 shadow-lg backdrop-blur">
      <span className="flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
        <Camera className="h-4 w-4" /> View
      </span>
      <SegmentedControl
        aria-label="Camera view"
        value={view}
        options={CAMERA_OPTS}
        onChange={setCameraView}
        stretch={false}
      />
    </div>
  );
}

/**
 * Docked camera-view row — the same switcher rendered as a config-panel `ControlRow`
 * (label + 300px segmented). The floating `CameraViewTabs` moves *into* the panel here
 * when the agent chat opens (Figma annotation: "camera view moves to top of the config
 * side panel").
 */
export function CameraViewRow() {
  const view = useVehicle((s) => s.view);
  return (
    <ControlRow label="View" icon={<Camera />} active>
      <SegmentedControl
        aria-label="Camera view"
        value={view}
        options={CAMERA_OPTS}
        onChange={setCameraView}
      />
    </ControlRow>
  );
}
