// ---------------------------------------------------------------------------
// Generic `feature.<name>` channel regression.
//
// The emulator grounds the LONG TAIL of cabin features (the ones the typed VehicleState
// schema — climate.*/body.*/lighting.*/… — does not model; carFunction alone is 348
// intents) onto a generic channel: `feature.<featureName> = on|off|<value>`. This suite
// pins the UI's handling of that channel:
//
//   • the featureStore mirrors every `feature.*` path (data-driven — unknown names too);
//   • the shared uiContract classifies `feature.*` as MAPPED (never dropped, never
//     ignore-listed) and asserts the store reflects it;
//   • rendering is BRAND-AGNOSTIC (BMW + Mercedes both flow through the same path);
//   • a valid grounded feature emits ZERO error-level console output;
//   • reset() clears the feature mirror.
//
// NOTE ON FIXTURES: the emulator on `main` does not yet emit `feature.*` (valid MBIS
// grounding is a pending emulator-agent branch — see docs/emulator/mbis-command-taxonomy.md,
// "Grounded vs NOT_IMPLEMENTED"). These fixtures are therefore SYNTHETIC, hand-authored to
// the documented wire shape. When the updated emulator lands, tools/gen_mercedes_golden.py
// will regenerate the Mercedes corpus WITH real feature.* paths and this suite's synthetic
// events become live-derived (the contract assertions are unchanged either way).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach } from "vitest";
import { ingest, reset, getMirror } from "../src/agent/bmwRenderer";
import { getFeatures, isFeatureOn, isFeatureOff, humanizeFeature } from "../src/state/featureStore";
import { clearConsole } from "../src/agent/agentStore";
import { setBrand, resetBrand } from "../src/brands/brandStore";
import { BMW } from "../src/brands/bmw";
import { MERCEDES } from "../src/brands/mercedes";
import { makeContract, errorLines } from "./uiContract";

/** A synthetic grounded-turn stream: a state_change over `feature.*` paths + an outcome. */
function featureTurn(features: Record<string, string>, result = "applied") {
  return [
    {
      v: 2,
      event: "state_change",
      changes: Object.entries(features).map(([name, to]) => ({ path: `feature.${name}`, from: "", to })),
      state_summary: "features",
    },
    { v: 2, event: "outcome", intent: "carFunction.set-carFunction.ambientLight", result, reason: null },
  ];
}

describe("feature.* store + rendering", () => {
  beforeEach(() => {
    reset();
    resetBrand();
    clearConsole();
  });

  it("mirrors every grounded feature.<name> into the featureStore", () => {
    for (const e of featureTurn({ ambientLight: "on", massage: "on", seatHeating: "HIGH" })) ingest(e);
    expect(getFeatures()).toEqual({ ambientLight: "on", massage: "on", seatHeating: "HIGH" });
  });

  it("renders an UNKNOWN feature name generically (never dropped, never an error)", () => {
    for (const e of featureTurn({ someBrandNewGizmo3000: "on" })) ingest(e);
    expect(getFeatures().someBrandNewGizmo3000).toBe("on");
    expect(errorLines()).toEqual([]);
  });

  it("classifies feature.* as MAPPED (not ignore-listed) and reflects it — both brands", () => {
    for (const brand of [BMW, MERCEDES]) {
      reset();
      clearConsole();
      setBrand(brand.id);
      const contract = makeContract(brand);
      const features = { ambientLight: "on", soundWorld: "fireplace", massage: "off" };
      for (const e of featureTurn(features)) ingest(e);
      const paths = Object.keys(features).map((n) => `feature.${n}`);
      for (const p of paths) {
        expect(contract.classify(p)).toBe("mapped");
        expect(contract.ignoreReason(p)).toBeNull();
      }
      // The full three-part contract: zero error output, mapped paths reflected, all classified.
      contract.assertContract(getMirror(), paths, { rejected: false });
    }
  });

  it("a later turn updates a feature value idempotently", () => {
    for (const e of featureTurn({ ambientLight: "on" })) ingest(e);
    expect(getFeatures().ambientLight).toBe("on");
    ingest({ v: 2, event: "state_change", changes: [{ path: "feature.ambientLight", from: "on", to: "off" }] });
    expect(getFeatures().ambientLight).toBe("off");
  });

  it("seeds features from a snapshot too (not only state_change)", () => {
    ingest({ v: 2, event: "snapshot", state: { "feature.tourGuide": "on", "climate.temperature.DRIVER": "21" } });
    expect(getFeatures().tourGuide).toBe("on");
  });

  it("reset() clears the feature mirror", () => {
    for (const e of featureTurn({ ambientLight: "on" })) ingest(e);
    expect(Object.keys(getFeatures())).toHaveLength(1);
    reset();
    expect(getFeatures()).toEqual({});
  });
});

describe("feature presentation helpers (pure)", () => {
  it("isFeatureOn / isFeatureOff read the common on/off tokens", () => {
    for (const on of ["on", "ON", "true", "1", "active", "enabled"]) expect(isFeatureOn(on)).toBe(true);
    for (const off of ["off", "false", "0", "inactive", "disabled"]) expect(isFeatureOff(off)).toBe(true);
    // A free/enum value is neither on nor off (renders as a value chip).
    expect(isFeatureOn("fireplace")).toBe(false);
    expect(isFeatureOff("fireplace")).toBe(false);
  });

  it("humanizeFeature makes camelCase/snake_case/dotted names legible", () => {
    expect(humanizeFeature("ambientLight")).toBe("Ambient Light");
    expect(humanizeFeature("seat_heating")).toBe("Seat Heating");
    expect(humanizeFeature("tourGuide.status")).toBe("Tour Guide · Status");
  });
});
