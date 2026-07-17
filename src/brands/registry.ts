// ---------------------------------------------------------------------------
// Brand registry + selection. Adding an OEM = adding a BrandConfig here.
//
// Selection precedence at runtime (see brandStore + agentRuntime):
//   1. Explicit `?brand=` query param  → PINS the brand (authoritative; no auto-switch).
//   2. Content-based auto-detect from the live NDJSON stream (detectBrand) when unpinned.
//   3. Default = BMW.
//
// Why content-detect and not the snapshot's "profile name": the NDJSON v2 snapshot event
// carries no profile-name field today (docs/emulator/ui-integration-api.md), and its
// state is the engine BOOT default (uppercase, WBA VIN) — identical for both cabins. The
// Mercedes identity only appears in the boot RECONCILE state_change (W1K VIN + lowercase
// MBIS zone keys). So we sniff the accumulated mirror after each event rather than the
// snapshot alone. `?brand=mercedes` is the deterministic demo selector.
// ---------------------------------------------------------------------------
import type { BrandConfig, BrandId } from "./types";
import { BMW } from "./bmw";
import { MERCEDES } from "./mercedes";

export const BRANDS: Record<BrandId, BrandConfig> = { bmw: BMW, mercedes: MERCEDES };
export const DEFAULT_BRAND: BrandConfig = BMW;

/** Detection order: the more specific (Mercedes) is tried before the default (BMW). */
const DETECTION_ORDER: BrandConfig[] = [MERCEDES, BMW];

/** Resolve a brand id string (case-insensitive) to its config, or null if unknown. */
export function getBrand(id?: string | null): BrandConfig | null {
  if (!id) return null;
  const key = id.trim().toLowerCase();
  return (BRANDS as Record<string, BrandConfig>)[key] ?? null;
}

/**
 * Content-detect the brand from a flattened emulator mirror. Returns the first brand
 * whose `detect()` matches, else null (caller keeps the current/default brand). Only the
 * positive Mercedes marker actually switches away from the default.
 */
export function detectBrand(state: Record<string, string>): BrandConfig | null {
  for (const b of DETECTION_ORDER) if (b.detect(state)) return b;
  return null;
}
