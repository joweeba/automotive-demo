// ---------------------------------------------------------------------------
// BrandConfig — the per-OEM configuration seam. "Configuration over code":
// rendering the emulator's NDJSON stream for a different vehicle (BMW vs Mercedes)
// is a matter of authoring a BrandConfig, NOT forking the renderer. The renderer
// (src/agent/bmwRenderer.ts) and the test oracle (test/uiContract.ts) both read the
// ACTIVE brand's config; nothing about a brand is hard-coded in the pipeline.
//
// The 3D rig has three seat anchors (driver / passenger / rear). Each brand maps its
// own cabin zone vocabulary onto those anchors via `zoneToSeat` — BMW's UPPERCASE
// bmw_new enum, Mercedes' lowercase MBIS spatialTarget vocab — so a per-zone command
// on either vehicle lands on a real anchor and is never silently dropped.
// ---------------------------------------------------------------------------
import type { SeatId } from "../state/vehicleState";

export type BrandId = "bmw" | "mercedes";

export interface BrandConfig {
  /** Stable id — matches the `?brand=` query param and the registry key. */
  id: BrandId;
  /** Full vehicle label shown in the head-unit chrome (e.g. "Mercedes-Benz EQS 580 4MATIC"). */
  label: string;
  /** Manufacturer, for compact chrome. */
  make: string;
  /** Wake-word display string (e.g. "hey mercedes"). Cosmetic — the model owns the real wake gate. */
  wakeWord: string;
  /** Console log prefix so multi-brand traces are attributable ("bmw" / "mb"). */
  logPrefix: string;
  /** The cabin zone set this trim physically has (for display / docs). */
  zones: string[];
  /** Cabin setpoint (°F) at/above which "heat" is inferred when AC & auto are off. */
  heatInferF: number;
  /**
   * Preferred `climate.temperature.<zone>` keys, most-representative first, used to pick
   * the cabin setpoint that drives the rig. Brand-specific because the boot snapshot seeds
   * the uppercase engine zones while the live per-zone value may be written under the
   * brand's OWN vocabulary (Mercedes lowercase) — the stale uppercase boot key must NOT
   * shadow the live lowercase one. The renderer and the test oracle both read this, so
   * they never disagree on which zone wins.
   */
  tempZones: string[];
  /**
   * This brand's cabin-zone vocabulary → the rig's three seat anchors. MUST cover every
   * zone token the brand's model can emit for a per-zone command (incl. aggregates and
   * the bare-call default) or that command lands on no anchor and is silently dropped.
   */
  zoneToSeat: Record<string, SeatId[]>;
  /**
   * Content-based brand detection: does this flattened emulator state look like THIS
   * vehicle? Used to auto-select the brand from the live stream when `?brand=` is absent
   * (the NDJSON snapshot carries no profile-name field today — see registry.ts).
   */
  detect: (state: Record<string, string>) => boolean;
}

export type { SeatId };
