// ---------------------------------------------------------------------------
// BMW brand config — the `bmw_new` vocabulary + BMW 3-series cabin, factored out of
// the renderer verbatim. This preserves the EXACT prior BMW behavior (the golden
// regression in test/variants.integration.test.ts must stay green): the zone→anchor
// table and the 74°F heat-inference threshold are copied unchanged from the original
// bmwRenderer.ts. BMW is also the default brand (see registry.ts).
// ---------------------------------------------------------------------------
import type { BrandConfig, SeatId } from "./types";

// The emulator's full 14-zone seat enum → this rig's three seat anchors. MUST cover
// every zone value the model can emit for a seat command — including the aggregates
// (ALL_CAR/FRONT/PASSENGERS) and the bare-call default ALL_CAR — or a seat command
// lands on no anchor and is silently dropped. Aggregates fan out to multiple anchors;
// the rig cannot split left/right within a row, so PASSENGER_LEFT/RIGHT collapse to
// the passenger anchor.
export const BMW_ZONE_TO_SEAT: Record<string, SeatId[]> = {
  DRIVER: ["driver"],
  FRONT_LEFT: ["driver"],
  PASSENGER: ["passenger"],
  FRONT_RIGHT: ["passenger"],
  PASSENGER_LEFT: ["passenger"],
  PASSENGER_RIGHT: ["passenger"],
  REAR_LEFT: ["rear"],
  REAR_RIGHT: ["rear"],
  REAR_CENTER: ["rear"],
  THIRD_ROW: ["rear"],
  BACK: ["rear"],
  FRONT: ["driver", "passenger"],
  PASSENGERS: ["passenger", "rear"],
  ALL_CAR: ["driver", "passenger", "rear"],
};

export const BMW: BrandConfig = {
  id: "bmw",
  label: "BMW 3 Series",
  make: "BMW",
  wakeWord: "hey bmw",
  logPrefix: "bmw",
  zones: ["driver", "passenger", "rear"],
  heatInferF: 74,
  tempZones: ["DRIVER", "ALL_CAR", "FRONT", "PASSENGER"],
  zoneToSeat: BMW_ZONE_TO_SEAT,
  // A BMW cabin: the bmw_3series profile reconciles to a WBA-prefixed VIN. (BMW is the
  // default, so detection is only a positive tie-breaker; absence of Mercedes markers
  // already falls back here.)
  detect: (s) => (s["info.VIN"] ?? "").toUpperCase().startsWith("WBA"),
};
