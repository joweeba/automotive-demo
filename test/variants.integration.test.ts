// ---------------------------------------------------------------------------
// EXHAUSTIVE cross-repo NDJSON integration regression.
//
// Ties OUR emulator's full bmw_new vocabulary to HER renderer. The generated
// corpus under test/fixtures/variants/ has one variant per
// (intent, valid_slot_combination) across all 58 intents (475 combos), plus
// extra variants so every enum value of every intent slot is exercised. See
// test/fixtures/README.md; regenerate with the assistant repo's
// tools/ui/gen_golden_ndjson.sh.
//
// For EACH variant this test resets the renderer, ingests the shared boot then
// the variant's turn events, and asserts:
//   (a) ZERO error-level console output (a genuine `rejected` outcome may be
//       error; not_equipped / not_implemented must NOT be).
//   (b) every emitted path the renderer MAPS is reflected in getState()/getMusic()
//       (no silent drop) — checked by independent oracles over the canonical
//       emitted paths, so a wrong-path regression (the class #181 caught) trips.
//   (c) every emitted state path is EITHER mapped OR on the explicit
//       KNOWN_UNRENDERED ignore-list. A path that is neither → FAIL. This is what
//       makes the regression exhaustive: a new/dropped subsystem can't pass
//       silently.
//
// (b)/(c) are DERIVED from the emitted paths — expected state is never
// hand-authored per variant (there are 800+).
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { ingest, reset, getMirror } from "../src/agent/bmwRenderer";
import { getState } from "../src/state/vehicleState";
import { getMusic, togglePlay, TRACKS } from "../src/state/musicStore";
import { getAgentState, clearConsole } from "../src/agent/agentStore";

const FIX = resolve(__dirname, "fixtures", "variants");

interface EmitterEvent {
  event: string;
  state?: Record<string, string>;
  changes?: { path: string; from?: string; to: string }[];
  intent?: string | null;
  result?: string;
}
interface VariantRecord {
  variant: string;
  intent: string;
  base: boolean;
  combo: string[];
  signature: string;
  events: EmitterEvent[];
}

/** The shared boot lines (snapshot + reconcile), parsed once. */
const BOOT: EmitterEvent[] = readFileSync(resolve(FIX, "_boot.ndjson"), "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as EmitterEvent);

/** Load every variant across all per-intent shard files. */
function loadVariants(): VariantRecord[] {
  const out: VariantRecord[] = [];
  for (const f of readdirSync(FIX).sort()) {
    if (!f.endsWith(".ndjson") || f === "_boot.ndjson") continue;
    for (const line of readFileSync(resolve(FIX, f), "utf8").split(/\r?\n/)) {
      if (line.trim()) out.push(JSON.parse(line) as VariantRecord);
    }
  }
  return out;
}
const VARIANTS = loadVariants();

/** Replay one variant from a clean slate: boot, then the variant's turn events. */
function replay(v: VariantRecord): void {
  reset();
  clearConsole();
  for (const e of BOOT) ingest(e);
  for (const e of v.events) ingest(e);
}

function errorLines(): string[] {
  return getAgentState()
    .consoleLog.filter((e) => e.level === "error")
    .map((e) => e.text);
}

/** All state paths a variant emits: boot snapshot keys + every state_change path. */
function emittedPaths(v: VariantRecord): Set<string> {
  const paths = new Set<string>();
  for (const e of [...BOOT, ...v.events]) {
    if (e.event === "snapshot" && e.state) Object.keys(e.state).forEach((p) => paths.add(p));
    if (e.event === "state_change" && e.changes)
      e.changes.forEach((c) => paths.add(c.path));
  }
  return paths;
}

// ── value parsing (independent oracle — mirrors the renderer's contract) ─────
const truthy = (v?: string) => v === "true" || v === "on" || v === "ON" || v === "1";
function parseTempF(raw?: string): number | null {
  if (raw == null) return null;
  const m = /(-?\d+(?:\.\d+)?)\s*([CF])?/i.exec(raw);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const unit = m[2]?.toUpperCase();
  if (unit === "C" || (!unit && n <= 40)) n = (n * 9) / 5 + 32;
  return n;
}
function firstZone(m: Record<string, string>, prefix: string, zones: string[]): string | undefined {
  for (const z of zones) if (m[`${prefix}.${z}`] !== undefined) return m[`${prefix}.${z}`];
  const k = Object.keys(m).find((p) => p.startsWith(`${prefix}.`));
  return k ? m[k] : m[prefix];
}
function anyZone(m: Record<string, string>, prefix: string, pred: (v: string) => boolean): boolean {
  return Object.entries(m).some(([p, v]) => (p === prefix || p.startsWith(`${prefix}.`)) && pred(v));
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
// Independent oracle copy of the renderer's zone→seat-anchor table. Must cover
// ALL 14 seat_heating zone enum values (incl. the aggregates ALL_CAR/FRONT/
// PASSENGERS and the bare-call default ALL_CAR) or a mapped seat-heating command
// is silently dropped.
type SeatId = "driver" | "passenger" | "rear";
const ZONE_TO_SEAT: Record<string, SeatId[]> = {
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
function seatLevel(v?: string): 0 | 1 | 2 | 3 {
  switch ((v ?? "").toUpperCase()) {
    case "LOW":
      return 1;
    case "MED":
    case "MEDIUM":
      return 2;
    case "HIGH":
      return 3;
    default:
      return 0;
  }
}

// ── (b) MAPPED paths + the oracle that asserts getState() reflects them ──────
// Each entry: a predicate matching the emitted path, and (once per replay) an
// independent check that the mapped UI state equals the canonical mirror value.
interface Mapped {
  id: string;
  match: (p: string) => boolean;
  check: (m: Record<string, string>) => void;
}
const MAPPED: Mapped[] = [
  {
    id: "climate.temperature.<zone> → temperature",
    match: (p) => p.startsWith("climate.temperature.") && p !== "climate.temperature_unit",
    check: (m) => {
      const tF = parseTempF(firstZone(m, "climate.temperature", ["DRIVER", "ALL_CAR", "FRONT", "PASSENGER"]));
      if (tF != null) expect(getState().temperature).toBe(clamp(Math.round(tF), 60, 85));
    },
  },
  {
    id: "climate.fan_speed.<zone> → fan",
    match: (p) => p.startsWith("climate.fan_speed."),
    check: (m) =>
      expect(getState().fan).toBe(anyZone(m, "climate.fan_speed", (v) => v !== "OFF" && v !== "0" && v !== "")),
  },
  {
    id: "climate.ac.<zone> → climate=ac",
    match: (p) => p.startsWith("climate.ac."),
    check: (m) => checkClimateMode(m),
  },
  {
    id: "climate.max_ac.<zone> → climate=ac",
    match: (p) => p.startsWith("climate.max_ac."),
    check: (m) => checkClimateMode(m),
  },
  {
    id: "climate.auto.<zone> → climate=auto",
    match: (p) => p.startsWith("climate.auto."),
    check: (m) => checkClimateMode(m),
  },
  {
    id: "climate.seat_heating.<zone> → seatHeat",
    match: (p) => p.startsWith("climate.seat_heating."),
    check: (m) => {
      const acc: Record<SeatId, 0 | 1 | 2 | 3> = { driver: 0, passenger: 0, rear: 0 };
      for (const [path, val] of Object.entries(m)) {
        if (!path.startsWith("climate.seat_heating.")) continue;
        for (const seat of ZONE_TO_SEAT[path.slice("climate.seat_heating.".length)] ?? []) {
          acc[seat] = Math.max(acc[seat], seatLevel(val)) as 0 | 1 | 2 | 3;
        }
      }
      (Object.keys(acc) as SeatId[]).forEach((s) => expect(getState().seatHeat[s]).toBe(acc[s]));
    },
  },
  {
    id: "info.EXTERIOR_TEMPERATURE → environment.externalTemp",
    match: (p) => p === "info.EXTERIOR_TEMPERATURE",
    check: (m) => {
      const extF = parseTempF(m["info.EXTERIOR_TEMPERATURE"]);
      if (extF != null) expect(getState().environment.externalTemp).toBe(clamp(Math.round(extF), 20, 110));
    },
  },
  {
    id: "lighting.light.{DRIVING,DAYTIME} → head/taillights",
    match: (p) => p === "lighting.light.DRIVING" || p === "lighting.light.DAYTIME",
    check: (m) => {
      const on = truthy(m["lighting.light.DRIVING"]) || truthy(m["lighting.light.DAYTIME"]);
      expect(getState().headlights).toBe(on ? "on" : "off");
      expect(getState().taillights).toBe(on ? "on" : "off");
    },
  },
  {
    id: "media.muted / media.volume → volume",
    match: (p) => p === "media.muted" || p === "media.volume",
    check: (m) => {
      const muted = truthy(m["media.muted"]);
      const volRaw = m["media.volume"];
      if (volRaw !== undefined) {
        const v = Math.round(Number(volRaw));
        if (!Number.isNaN(v)) expect(getMusic().volume).toBe(muted ? 0 : v);
      } else if (muted) {
        expect(getMusic().volume).toBe(0);
      }
    },
  },
  {
    id: "media.source → playing",
    match: (p) => p === "media.source",
    check: (m) => {
      if (m["media.source"]) expect(getMusic().playing).toBe(true);
    },
  },
  {
    id: "media.track_index → track index",
    match: (p) => p === "media.track_index",
    check: (m) => {
      const idx = m["media.track_index"];
      if (idx !== undefined && !Number.isNaN(Number(idx)))
        expect(getMusic().index).toBe(Number(idx) % TRACKS.length);
    },
  },
];

function checkClimateMode(m: Record<string, string>): void {
  const acOn = anyZone(m, "climate.ac", truthy) || anyZone(m, "climate.max_ac", truthy);
  const autoOn = anyZone(m, "climate.auto", truthy);
  const tF = parseTempF(firstZone(m, "climate.temperature", ["DRIVER", "ALL_CAR", "FRONT", "PASSENGER"]));
  const extF = parseTempF(m["info.EXTERIOR_TEMPERATURE"]);
  let mode: "off" | "auto" | "ac" | "heat" = "off";
  if (acOn) mode = "ac";
  else if (autoOn) mode = "auto";
  else if (tF != null && ((extF != null && tF > extF + 2) || tF >= 74)) mode = "heat";
  expect(getState().climate).toBe(mode);
}

// ── (c) KNOWN_UNRENDERED — emitted paths with no 3D representation (yet) ─────
// Each matcher documents WHY the path has no visual in the web sedan rig. A path
// that matches neither MAPPED nor this list fails the exhaustiveness assertion.
interface Ignored {
  match: (p: string) => boolean;
  reason: string;
}
const KNOWN_UNRENDERED: Ignored[] = [
  { match: (p) => p === "climate.temperature_unit", reason: "unit label only; cabin temp is shown in °F" },
  { match: (p) => p.startsWith("climate.defrost."), reason: "no defroster visual in the 3D rig" },
  { match: (p) => p.startsWith("climate.seat_cooling."), reason: "seat ventilation has no 3D representation (only seat heating is shown)" },
  { match: (p) => p === "climate.steering_wheel_heating", reason: "no steering-wheel heating visual" },
  { match: (p) => p === "climate.sync", reason: "climate sync is a control-logic flag, no 3D representation" },
  { match: (p) => p.startsWith("climate.massage"), reason: "massage (on/off, type, intensity, speed) has no 3D representation" },
  { match: (p) => p.startsWith("body.window."), reason: "windows not yet modeled in the 3D rig (MAP CANDIDATE — see report)" },
  { match: (p) => p === "body.sunroof", reason: "sunroof not yet modeled in the 3D rig (MAP CANDIDATE)" },
  { match: (p) => p.startsWith("body.blind."), reason: "blinds/shades not modeled" },
  { match: (p) => p === "body.mirrors_folded", reason: "mirror fold not modeled" },
  { match: (p) => p.startsWith("body.seat_position."), reason: "seat position (recline/slide/height) not modeled" },
  // lighting.light.DRIVING/DAYTIME are MAPPED above; the rest have no distinct visual.
  { match: (p) => p.startsWith("lighting.light.") && p !== "lighting.light.DRIVING" && p !== "lighting.light.DAYTIME", reason: "only driving/daytime beams drive the 3D headlights; ambient/hazard/home/lock/parking/reading/welcome light types have no distinct visual" },
  { match: (p) => p === "lighting.ambient_color", reason: "cabin ambient color not yet driven in the 3D rig (MAP CANDIDATE)" },
  { match: (p) => p === "lighting.cockpit_brightness", reason: "cockpit brightness has no 3D representation" },
  { match: (p) => p.startsWith("lighting.warning."), reason: "driver-assist warnings are cluster/HUD, not the 3D rig" },
  { match: (p) => p === "drive.mode", reason: "drive mode is a cluster/HUD label (MAP CANDIDATE)" },
  { match: (p) => p === "drive.start_stop", reason: "engine start/stop has no 3D representation" },
  { match: (p) => p === "drive.parking", reason: "automated parking maneuver not animated" },
  { match: (p) => p === "drive.acc_distance", reason: "ACC following distance is a cluster setting" },
  { match: (p) => p === "drive.emergency_stop", reason: "emergency stop not animated" },
  // info.EXTERIOR_TEMPERATURE is MAPPED above; the rest are read-only panel data.
  { match: (p) => p.startsWith("info.") && p !== "info.EXTERIOR_TEMPERATURE", reason: "read-only vehicle info (fuel/range/mileage/VIN/model/tire pressure) surfaced in panels, not the 3D rig" },
  { match: (p) => p === "media.station", reason: "station is free text; no 3D representation" },
  { match: (p) => p === "media.snapshot", reason: "camera snapshot has no 3D representation" },
  { match: (p) => p.startsWith("nav."), reason: "navigation state belongs to the map view, not the 3D car rig" },
  { match: (p) => p.startsWith("apps."), reason: "apps/infotainment screen, not the 3D car rig" },
  { match: (p) => p.startsWith("comms."), reason: "phone/comms UI, not the 3D car rig" },
  { match: (p) => p.startsWith("system."), reason: "HMI unit conventions (12H/24H, mile/km), not the 3D car rig" },
];

function isMapped(p: string): boolean {
  return MAPPED.some((mp) => mp.match(p));
}
function ignoreReason(p: string): string | null {
  return KNOWN_UNRENDERED.find((ig) => ig.match(p))?.reason ?? null;
}
function classify(p: string): "mapped" | "ignored" | "unclassified" {
  if (isMapped(p)) return "mapped";
  return ignoreReason(p) ? "ignored" : "unclassified";
}

describe("exhaustive UI integration corpus", () => {
  it("loaded a non-trivial corpus (>= 475 variants across all 58 intents)", () => {
    expect(VARIANTS.length).toBeGreaterThanOrEqual(475);
    expect(new Set(VARIANTS.map((v) => v.intent)).size).toBe(58);
  });

  it("no MAPPED path is also on the ignore-list (mutually exclusive)", () => {
    // Sample across the full emitted universe.
    const universe = new Set<string>();
    for (const v of VARIANTS) emittedPaths(v).forEach((p) => universe.add(p));
    for (const p of universe) {
      if (isMapped(p)) expect(ignoreReason(p), `${p} is mapped AND ignore-listed`).toBeNull();
    }
  });

  beforeEach(() => {
    reset();
    clearConsole();
  });

  // One replay per variant; assert (a) no error spew, (b) mapped paths reflected,
  // (c) every emitted path classified.
  for (const v of VARIANTS) {
    it(`${v.variant}  [${v.signature}]`, () => {
      replay(v);
      const m = getMirror();
      const paths = emittedPaths(v);

      // (a) A genuine `rejected` outcome is allowed to be error; the corpus never
      // contains one (every signature validates), so this is effectively zero.
      const rejected = v.events.some((e) => e.event === "outcome" && e.result === "rejected");
      if (!rejected) expect(errorLines()).toEqual([]);

      // (b) each mapped path emitted → its oracle asserts getState() reflects it.
      const ran = new Set<string>();
      for (const p of paths) {
        for (const mp of MAPPED) {
          if (mp.match(p) && !ran.has(mp.id)) {
            ran.add(mp.id);
            mp.check(m);
          }
        }
      }

      // (c) every emitted path is mapped or explicitly ignore-listed.
      const unclassified = [...paths].filter((p) => classify(p) === "unclassified");
      expect(unclassified, `unclassified emitted paths: ${unclassified.join(", ")}`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Mapped-path contract pins (isolated). The corpus always replays the full boot
// state, whose ALL_CAR seeds keep climate mode = "ac" — masking the auto/heat
// branches. These micro-scenarios ingest a minimal snapshot so each mapped path's
// exact wiring is pinned unambiguously (this is the wrong-path regression class
// assistant #181 caught: `climate.climate_auto` vs `climate.auto.<zone>`,
// `info.exterior_temp` vs `info.EXTERIOR_TEMPERATURE`).
// ---------------------------------------------------------------------------
describe("mapped-path contract pins (isolated)", () => {
  const snap = (state: Record<string, string>) => {
    reset();
    clearConsole();
    ingest({ v: 2, event: "snapshot", state });
  };

  it("climate.auto.<zone> (not climate.climate_auto) → climate = auto", () => {
    // Decisive: a warm setpoint over a cool outside would infer "heat"; reading
    // climate.auto.<zone> must override that to "auto". A renderer reading the
    // wrong path (the #181 `climate.climate_auto` bug) would land on "heat".
    snap({
      "climate.temperature.DRIVER": "80",
      "info.EXTERIOR_TEMPERATURE": "50",
      "climate.auto.DRIVER": "ON",
    });
    expect(getState().climate).toBe("auto");
  });

  it("climate.ac.<zone> → climate = ac (wins over auto)", () => {
    snap({ "climate.ac.DRIVER": "ON", "climate.auto.DRIVER": "ON" });
    expect(getState().climate).toBe("ac");
  });

  it("info.EXTERIOR_TEMPERATURE (UPPER_SNAKE) → environment.externalTemp", () => {
    snap({ "info.EXTERIOR_TEMPERATURE": "57" });
    expect(getState().environment.externalTemp).toBe(57);
  });

  it("climate.temperature.<zone> → temperature (°F, clamped)", () => {
    snap({ "climate.temperature.DRIVER": "71" });
    expect(getState().temperature).toBe(71);
  });

  it("climate.fan_speed.<zone> → fan on/off", () => {
    snap({ "climate.fan_speed.DRIVER": "OFF" });
    expect(getState().fan).toBe(false);
    snap({ "climate.fan_speed.DRIVER": "MAX" });
    expect(getState().fan).toBe(true);
  });

  it("climate.seat_heating.<zone> → seatHeat anchor", () => {
    snap({ "climate.seat_heating.DRIVER": "HIGH" });
    expect(getState().seatHeat.driver).toBe(3);
  });

  it("climate.seat_heating.ALL_CAR (bare-call default) → all three seat anchors", () => {
    // The most common seat-heating command grounds to ALL_CAR; it must reach
    // every seat anchor, not be silently dropped. Hardcoded expectation — does
    // not use ZONE_TO_SEAT — so a regressed table trips here.
    snap({ "climate.seat_heating.ALL_CAR": "MEDIUM" });
    expect(getState().seatHeat).toEqual({ driver: 2, passenger: 2, rear: 2 });
  });

  it("climate.seat_heating.FRONT → driver + passenger anchors", () => {
    snap({ "climate.seat_heating.FRONT": "HIGH" });
    expect(getState().seatHeat.driver).toBe(3);
    expect(getState().seatHeat.passenger).toBe(3);
    expect(getState().seatHeat.rear).toBe(0);
  });

  it("lighting.light.DRIVING → headlights on", () => {
    snap({ "lighting.light.DRIVING": "on" });
    expect(getState().headlights).toBe("on");
    expect(getState().taillights).toBe("on");
  });

  it("media.muted → volume 0", () => {
    snap({ "media.volume": "40", "media.muted": "true" });
    expect(getMusic().volume).toBe(0);
  });

  it("media.track_index → wrapped track index", () => {
    snap({ "media.track_index": String(TRACKS.length + 1) });
    expect(getMusic().index).toBe(1 % TRACKS.length);
  });

  it("media.source → playing (decisive from a paused start)", () => {
    // Music starts playing:true and no corpus variant pauses it, so assert from a
    // paused state: a media.source snapshot must flip playing on. If applyMedia's
    // togglePlay wiring were removed, this trips.
    if (getMusic().playing) togglePlay();
    expect(getMusic().playing).toBe(false);
    snap({ "media.source": "SPOTIFY" });
    expect(getMusic().playing).toBe(true);
  });
});
