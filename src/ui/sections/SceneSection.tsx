import { useVehicle, GROUND_ORDER, GROUND_LABELS } from "../../state/vehicleState";
import type { GroundId } from "../../state/vehicleState";
import { setGround } from "../../state/vehicleCommands";
import { SegmentedControl, type SegmentedOption } from "../controls/SegmentedControl";
import { Road } from "../icons";

const GROUND_OPTS: SegmentedOption<GroundId>[] = GROUND_ORDER.map((id) => ({
  value: id,
  label: GROUND_LABELS[id],
}));

/**
 * Floating ground / surface switcher — same pill styling as `CameraViewTabs`, so it
 * sits directly beneath the View tabs top-right over the viewport.
 */
export function GroundTabs() {
  const ground = useVehicle((s) => s.ground);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/70 px-3 py-2 shadow-lg backdrop-blur">
      <span className="flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
        <Road className="h-4 w-4" /> Ground
      </span>
      <SegmentedControl
        aria-label="Ground surface"
        value={ground}
        options={GROUND_OPTS}
        onChange={setGround}
        stretch={false}
      />
    </div>
  );
}

/** Docked ground row — the same switcher as a full-width control, used when the
 *  agent chat is open and the View/Ground controls dock into the config panel top. */
export function GroundRow() {
  const ground = useVehicle((s) => s.ground);
  return (
    <SegmentedControl
      aria-label="Ground surface"
      value={ground}
      options={GROUND_OPTS}
      onChange={setGround}
    />
  );
}
