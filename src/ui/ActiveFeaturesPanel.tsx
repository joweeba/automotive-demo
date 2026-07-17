import { useFeatures, isFeatureOn, isFeatureOff, humanizeFeature } from "../state/featureStore";
import { PANEL_STYLE } from "./panelStyle";

// ---------------------------------------------------------------------------
// ActiveFeaturesPanel — a DATA-DRIVEN "active features" overlay.
//
// Renders the generic `feature.<name>` channel (see src/state/featureStore.ts +
// docs/emulator/ui-integration-api.md). The emulator grounds the long-tail of cabin
// commands (carFunction alone is 348 intents) that the typed 3D rig can't model onto
// this channel, so EVERY grounded command shows visible feedback here — name + on/off/
// value — even for a feature name this UI has never seen. Nothing is per-feature coded;
// unknown names render generically (humanized) rather than being dropped.
//
// The panel is only shown when there is at least one active feature (so it never clutters
// the base demo), and floats top-left over the viewport.
// ---------------------------------------------------------------------------

function FeatureValueBadge({ value }: { value: string }) {
  const on = isFeatureOn(value);
  const off = isFeatureOff(value);
  // on → accent pill, off → muted pill, any other value (enum/free) → neutral value chip.
  const cls = on
    ? "bg-[var(--primary,#3b82f6)]/15 text-[var(--primary,#3b82f6)]"
    : off
      ? "bg-muted text-muted-foreground"
      : "bg-foreground/10 text-foreground";
  const label = on ? "On" : off ? "Off" : value;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {label}
    </span>
  );
}

export function ActiveFeaturesPanel() {
  // Sort by name for a stable, legible list.
  const features = useFeatures((f) =>
    Object.entries(f).sort(([a], [b]) => a.localeCompare(b)),
  );
  if (features.length === 0) return null;

  const activeCount = features.filter(([, v]) => !isFeatureOff(v)).length;

  return (
    <div
      className="pointer-events-auto w-[280px] max-w-[calc(100%-2.5rem)] p-3 shadow-overlay"
      style={PANEL_STYLE}
      aria-label="Active vehicle features"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Active Features
        </span>
        <span className="text-xs text-muted-foreground">{activeCount}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {features.map(([name, value]) => (
          <li key={name} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-foreground" title={name}>
              {humanizeFeature(name)}
            </span>
            <FeatureValueBadge value={value} />
          </li>
        ))}
      </ul>
    </div>
  );
}
