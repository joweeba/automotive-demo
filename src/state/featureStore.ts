import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// featureStore — the generic "active features" mirror.
//
// The emulator grounds the long-tail of cabin features (the ones the typed
// VehicleState schema — climate.*/body.*/lighting.*/… — does not model) onto a
// GENERIC channel: `feature.<featureName> = on|off|<value>`
// (e.g. `feature.ambientLight=on`, `feature.massage=on`, `feature.seatHeating=HIGH`,
// `feature.soundWorld=fireplace`). See docs/emulator/ui-integration-api.md +
// docs/emulator/mbis-command-taxonomy.md — carFunction alone is 348 intents, most of
// which have no dedicated 3D affordance but MUST still show visible feedback when a
// valid command grounds.
//
// This store is DATA-DRIVEN: it holds an arbitrary name→value map and never enumerates
// feature names in code. Any grounded `feature.*` path — known or not — lands here and
// is rendered generically by ActiveFeaturesPanel, so nothing is silently dropped.
//
// Same lightweight store pattern as vehicleState (get/set/subscribe + a hook). The
// renderer (src/agent/bmwRenderer.ts) is the only writer; it reconciles the whole map
// from its mirror on every relevant event (idempotent).
// ---------------------------------------------------------------------------

/** name → value ("on" | "off" | any enum/free value the emulator grounded). */
export type FeatureMap = Record<string, string>;

let features: FeatureMap = {};
const listeners = new Set<() => void>();
// Stable empty snapshot so useSyncExternalStore doesn't loop when there are no features.
const EMPTY: FeatureMap = Object.freeze({});

export function getFeatures(): FeatureMap {
  return features;
}

/** Replace the entire feature map (idempotent reconcile). No-op notify if unchanged. */
export function setFeatures(next: FeatureMap): void {
  const keys = Object.keys(next);
  const cur = features;
  // Cheap equality check so an idempotent reconcile does not thrash subscribers.
  if (keys.length === Object.keys(cur).length && keys.every((k) => cur[k] === next[k])) return;
  features = keys.length === 0 ? EMPTY : { ...next };
  listeners.forEach((l) => l());
}

/** Set a single feature value (used by the renderer's incremental path). */
export function setFeature(name: string, value: string): void {
  setFeatures({ ...features, [name]: value });
}

/** Clear all features (e.g. before reconnecting to a fresh emulator). */
export function resetFeatures(): void {
  setFeatures({});
}

export function subscribeFeatures(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useFeatures<T>(selector: (f: FeatureMap) => T): T {
  return useSyncExternalStore(
    subscribeFeatures,
    () => selector(features),
    () => selector(features),
  );
}

// ── presentation helpers (pure — shared by the panel + tests) ────────────────

/** A feature value that reads as "on" (highlighted) vs "off"/other. */
export function isFeatureOn(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "on" || v === "true" || v === "1" || v === "active" || v === "enabled";
}

/** A feature value that reads as an explicit "off". */
export function isFeatureOff(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "off" || v === "false" || v === "0" || v === "inactive" || v === "disabled";
}

/** Humanize a camelCase / snake_case / dotted feature name for display.
 *  `ambientLight` → "Ambient Light"; `seat_heating` → "Seat Heating";
 *  `tourGuide.status` → "Tour Guide · Status". */
export function humanizeFeature(name: string): string {
  return name
    .split(".")
    .map((seg) =>
      seg
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase → camel Case
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    )
    .join(" · ");
}
