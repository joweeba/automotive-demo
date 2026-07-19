// ---------------------------------------------------------------------------
// Active-brand store — the single source of truth for which OEM the UI is currently
// rendering. The renderer, the head-unit chrome (Header), and the test oracle all read
// the active brand from here so they can never disagree about the vehicle.
//
// A `?brand=` selection LOCKS the brand (authoritative for the demo); otherwise the
// renderer calls autoDetectBrand() as the live stream arrives and the store switches when
// the Mercedes markers appear. Same useSyncExternalStore shape as state/vehicleState.ts.
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from "react";
import type { BrandConfig, BrandId } from "./types";
import { DEFAULT_BRAND, detectBrand, getBrand } from "./registry";

interface BrandState {
  brand: BrandConfig;
  /** True when the brand was pinned explicitly (`?brand=`) — auto-detect will not override. */
  locked: boolean;
}

let state: BrandState = { brand: DEFAULT_BRAND, locked: false };
const listeners = new Set<() => void>();

function set(next: BrandState): void {
  // Reference-stable no-op guard so useSyncExternalStore doesn't churn.
  if (next.brand === state.brand && next.locked === state.locked) return;
  state = next;
  listeners.forEach((l) => l());
}

export function getBrandState(): BrandState {
  return state;
}

/** The currently active brand config. */
export function getActiveBrand(): BrandConfig {
  return state.brand;
}

/**
 * Select a brand by id. `lock` (default true) marks it authoritative — the intended
 * behavior for an explicit `?brand=` selection. Returns the resolved config, or null if
 * the id is unknown (the active brand is left unchanged).
 */
export function setBrand(id: BrandId | string, opts: { lock?: boolean } = {}): BrandConfig | null {
  const brand = getBrand(id);
  if (!brand) return null;
  set({ brand, locked: opts.lock ?? true });
  return brand;
}

/**
 * Auto-detect the brand from the accumulated emulator mirror and switch to it if a
 * positively-identified, NON-default brand is found. STICKY by design: it never reverts to
 * the default brand on a momentarily brand-neutral mirror. This matters because the engine
 * BOOT snapshot is brand-neutral (uppercase, WBA VIN) for BOTH cabins, and onSnapshot
 * replaces the mirror wholesale — so a reconnect/re-snapshot would otherwise flip an
 * already-detected Mercedes back to BMW until the following reconcile re-adds the markers.
 * No-op when the brand is locked (an explicit `?brand=` wins). Called by the renderer on
 * every snapshot / state_change.
 */
export function autoDetectBrand(mirror: Record<string, string>): void {
  if (state.locked) return;
  const detected = detectBrand(mirror);
  if (detected && detected !== DEFAULT_BRAND && detected !== state.brand) {
    set({ brand: detected, locked: false });
  }
}

/** Reset to the default brand, unlocked (used by the renderer reset + tests). */
export function resetBrand(): void {
  set({ brand: DEFAULT_BRAND, locked: false });
}

/** React hook: subscribe to the active brand config. */
export function useBrand(): BrandConfig {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.brand,
    () => state.brand,
  );
}
