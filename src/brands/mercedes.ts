// ---------------------------------------------------------------------------
// Mercedes brand config — the MBIS vocabulary + Mercedes-Benz EQS cabin.
//
// The Mercedes emulator (brand_profiles/mercedes + emulator_profiles/mercedes_eqs)
// emits the SAME flattened VehicleState schema as BMW (climate.*, body.*, media.*, …),
// so the shared renderer + path classifier work unchanged. What differs is the ZONE
// VOCABULARY: MBIS uses lowercase spatialTarget tokens (driver / co-driver / rear_left /
// rear_right) plus the ALL_CAR aggregate, whereas the engine BOOT snapshot still seeds
// the uppercase bmw-style zone keys (DRIVER / PASSENGER / REAR_LEFT / REAR_RIGHT) before
// the boot reconcile overlays the MBIS ones. The mirror therefore carries BOTH — so
// zoneToSeat maps BOTH casings onto the rig's three anchors, and no per-zone command is
// dropped regardless of which vocabulary emitted it. (docs/emulator/mbis-command-taxonomy.md)
// ---------------------------------------------------------------------------
import type { BrandConfig, SeatId } from "./types";
import { BMW_ZONE_TO_SEAT } from "./bmw";

// The EQS is a large sedan: two front + two rear outboard seats mapped onto the rig's
// driver / passenger / rear anchors. co-driver → passenger; both rear outboard seats
// collapse to the single rear anchor. Includes the uppercase boot-snapshot zones (via
// the BMW table) + MBIS lowercase tokens + defensive extra spatialTarget aggregates so a
// grounded climate/seat command (landing separately) never misses an anchor.
export const MERCEDES_ZONE_TO_SEAT: Record<string, SeatId[]> = {
  ...BMW_ZONE_TO_SEAT, // uppercase boot zones + ALL_CAR/FRONT/PASSENGERS aggregates
  // MBIS lowercase spatialTarget vocabulary
  driver: ["driver"],
  "co-driver": ["passenger"],
  codriver: ["passenger"],
  passenger: ["passenger"],
  front_left: ["driver"],
  front_right: ["passenger"],
  rear_left: ["rear"],
  rear_right: ["rear"],
  rear_center: ["rear"],
  rear: ["rear"],
  front: ["driver", "passenger"],
  all: ["driver", "passenger", "rear"],
  all_car: ["driver", "passenger", "rear"],
};

export const MERCEDES: BrandConfig = {
  id: "mercedes",
  label: "Mercedes-Benz EQS 580 4MATIC",
  make: "Mercedes-Benz",
  wakeWord: "hey mercedes",
  logPrefix: "mb",
  zones: ["driver", "co-driver", "rear_left", "rear_right"],
  heatInferF: 74,
  // Prefer the live lowercase MBIS zone (what a grounded carFunction.set-temperature
  // writes) over the stale uppercase boot-default key that lingers in the mirror; fall
  // back to the aggregate / uppercase boot keys so a bare snapshot still reads.
  tempZones: ["driver", "co-driver", "rear_left", "rear_right", "ALL_CAR", "DRIVER"],
  zoneToSeat: MERCEDES_ZONE_TO_SEAT,
  // The EQS reconciles to a W1K-prefixed VIN, and the MBIS boot reconcile writes the
  // lowercase spatialTarget zone keys — either marker positively identifies the cabin.
  // (The bare boot snapshot alone looks bmw-like; detection fires once the reconcile
  // state_change lands — see registry.detectBrand.)
  detect: (s) =>
    (s["info.VIN"] ?? "").toUpperCase().startsWith("W1K") ||
    Object.keys(s).some(
      (k) => k.endsWith(".co-driver") || k.endsWith(".rear_left") || k.endsWith(".rear_right"),
    ),
};
