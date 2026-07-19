// ---------------------------------------------------------------------------
// EXHAUSTIVE cross-repo NDJSON integration regression (IN-PROCESS fixture replay).
//
// Ties OUR emulator's full bmw_new vocabulary to HER renderer. The generated
// corpus under test/fixtures/variants/ has one variant per
// (intent, valid_slot_combination) across all 58 intents (475 combos), plus
// extra variants so every enum value of every intent slot is exercised. See
// test/fixtures/README.md; regenerate with the assistant repo's
// tools/ui/gen_golden_ndjson.sh.
//
// For EACH variant this test resets the renderer, ingests the shared boot then
// the variant's turn events, and asserts the shared (a)+(b)+(c) contract in
// ./uiContract (zero error output, mapped paths reflected, every path classified).
//
// The SAME contract is asserted LIVE (real emulator process + WebSocket + inbound
// audio) by test/e2e/liveE2E.test.ts — this file proves the MAPPING, that one proves
// the TRANSPORT. Both import ./uiContract so they can never drift.
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { ingest, reset, getMirror } from "../src/agent/bmwRenderer";
import { getState } from "../src/state/vehicleState";
import { getMusic, togglePlay, TRACKS } from "../src/state/musicStore";
import { clearConsole } from "../src/agent/agentStore";
import { MAPPED, isMapped, ignoreReason, classify, errorLines } from "./uiContract";

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

/** All state paths a variant emits: boot snapshot keys + every state_change path. */
function emittedPaths(v: VariantRecord): Set<string> {
  const paths = new Set<string>();
  for (const e of [...BOOT, ...v.events]) {
    if (e.event === "snapshot" && e.state) Object.keys(e.state).forEach((p) => paths.add(p));
    if (e.event === "state_change" && e.changes) e.changes.forEach((c) => paths.add(c.path));
  }
  return paths;
}

describe("exhaustive UI integration corpus", () => {
  it("loaded a non-trivial corpus (>= 475 variants across all 58 intents)", () => {
    expect(VARIANTS.length).toBeGreaterThanOrEqual(475);
    expect(new Set(VARIANTS.map((v) => v.intent)).size).toBe(58);
  });

  it("no MAPPED path is also on the ignore-list (mutually exclusive)", () => {
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
    if (getMusic().playing) togglePlay();
    expect(getMusic().playing).toBe(false);
    snap({ "media.source": "SPOTIFY" });
    expect(getMusic().playing).toBe(true);
  });
});
