// ---------------------------------------------------------------------------
// Shared UI-contract oracle for the emulator↔renderer NDJSON protocol.
//
// This is the SINGLE definition of the three-part contract both cross-repo
// regressions assert:
//   (a) ZERO error-level console output for a non-rejected turn.
//   (b) every emitted path the renderer MAPS is reflected in getState()/getMusic()
//       (an independent oracle over the canonical emitted paths — a wrong-path
//       regression trips it).
//   (c) every emitted state path is EITHER mapped OR on the explicit
//       KNOWN_UNRENDERED ignore-list (a new/dropped subsystem can't pass silently).
//
// Consumed by BOTH:
//   • test/variants.integration.test.ts  — in-process golden fixture replay (proves
//     the grounding→renderer MAPPING).
//   • test/e2e/liveE2E.test.ts           — LIVE cross-process replay through the real
//     emulator + WebSocket (proves the TRANSPORT + inbound audio).
// Sharing it here is what keeps the live path asserting the SAME contract the golden
// regression uses, with no drift.
// ---------------------------------------------------------------------------
import { expect } from "vitest";
import { getState } from "../src/state/vehicleState";
import { getMusic, TRACKS } from "../src/state/musicStore";
import { getAgentState } from "../src/agent/agentStore";

// ── value parsing (independent oracle — mirrors the renderer's contract) ─────
export const truthy = (v?: string) =>
  v === "true" || v === "on" || v === "ON" || v === "1";

export function parseTempF(raw?: string): number | null {
  if (raw == null) return null;
  const m = /(-?\d+(?:\.\d+)?)\s*([CF])?/i.exec(raw);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const unit = m[2]?.toUpperCase();
  if (unit === "C" || (!unit && n <= 40)) n = (n * 9) / 5 + 32;
  return n;
}

export function firstZone(
  m: Record<string, string>,
  prefix: string,
  zones: string[],
): string | undefined {
  for (const z of zones) if (m[`${prefix}.${z}`] !== undefined) return m[`${prefix}.${z}`];
  const k = Object.keys(m).find((p) => p.startsWith(`${prefix}.`));
  return k ? m[k] : m[prefix];
}

export function anyZone(
  m: Record<string, string>,
  prefix: string,
  pred: (v: string) => boolean,
): boolean {
  return Object.entries(m).some(([p, v]) => (p === prefix || p.startsWith(`${prefix}.`)) && pred(v));
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

type SeatId = "driver" | "passenger" | "rear";
// Independent oracle copy of the renderer's zone→seat-anchor table. Must cover ALL 14
// seat_heating zone enum values (incl. the aggregates ALL_CAR/FRONT/PASSENGERS and the
// bare-call default ALL_CAR) or a mapped seat-heating command is silently dropped.
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

function checkClimateMode(m: Record<string, string>): void {
  const acOn = anyZone(m, "climate.ac", truthy) || anyZone(m, "climate.max_ac", truthy);
  const autoOn = anyZone(m, "climate.auto", truthy);
  const tF = parseTempF(
    firstZone(m, "climate.temperature", ["DRIVER", "ALL_CAR", "FRONT", "PASSENGER"]),
  );
  const extF = parseTempF(m["info.EXTERIOR_TEMPERATURE"]);
  let mode: "off" | "auto" | "ac" | "heat" = "off";
  if (acOn) mode = "ac";
  else if (autoOn) mode = "auto";
  else if (tF != null && ((extF != null && tF > extF + 2) || tF >= 74)) mode = "heat";
  expect(getState().climate).toBe(mode);
}

// ── (b) MAPPED paths + the oracle that asserts getState() reflects them ──────
export interface Mapped {
  id: string;
  match: (p: string) => boolean;
  check: (m: Record<string, string>) => void;
}
export const MAPPED: Mapped[] = [
  {
    id: "climate.temperature.<zone> → temperature",
    match: (p) => p.startsWith("climate.temperature.") && p !== "climate.temperature_unit",
    check: (m) => {
      const tF = parseTempF(
        firstZone(m, "climate.temperature", ["DRIVER", "ALL_CAR", "FRONT", "PASSENGER"]),
      );
      if (tF != null) expect(getState().temperature).toBe(clamp(Math.round(tF), 60, 85));
    },
  },
  {
    id: "climate.fan_speed.<zone> → fan",
    match: (p) => p.startsWith("climate.fan_speed."),
    check: (m) =>
      expect(getState().fan).toBe(
        anyZone(m, "climate.fan_speed", (v) => v !== "OFF" && v !== "0" && v !== ""),
      ),
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

// ── (c) KNOWN_UNRENDERED — emitted paths with no 3D representation (yet) ─────
export interface Ignored {
  match: (p: string) => boolean;
  reason: string;
}
export const KNOWN_UNRENDERED: Ignored[] = [
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
  { match: (p) => p.startsWith("lighting.light.") && p !== "lighting.light.DRIVING" && p !== "lighting.light.DAYTIME", reason: "only driving/daytime beams drive the 3D headlights; ambient/hazard/home/lock/parking/reading/welcome light types have no distinct visual" },
  { match: (p) => p === "lighting.ambient_color", reason: "cabin ambient color not yet driven in the 3D rig (MAP CANDIDATE)" },
  { match: (p) => p === "lighting.cockpit_brightness", reason: "cockpit brightness has no 3D representation" },
  { match: (p) => p.startsWith("lighting.warning."), reason: "driver-assist warnings are cluster/HUD, not the 3D rig" },
  { match: (p) => p === "drive.mode", reason: "drive mode is a cluster/HUD label (MAP CANDIDATE)" },
  { match: (p) => p === "drive.start_stop", reason: "engine start/stop has no 3D representation" },
  { match: (p) => p === "drive.parking", reason: "automated parking maneuver not animated" },
  { match: (p) => p === "drive.acc_distance", reason: "ACC following distance is a cluster setting" },
  { match: (p) => p === "drive.emergency_stop", reason: "emergency stop not animated" },
  { match: (p) => p.startsWith("info.") && p !== "info.EXTERIOR_TEMPERATURE", reason: "read-only vehicle info (fuel/range/mileage/VIN/model/tire pressure) surfaced in panels, not the 3D rig" },
  { match: (p) => p === "media.station", reason: "station is free text; no 3D representation" },
  { match: (p) => p === "media.snapshot", reason: "camera snapshot has no 3D representation" },
  { match: (p) => p.startsWith("nav."), reason: "navigation state belongs to the map view, not the 3D car rig" },
  { match: (p) => p.startsWith("apps."), reason: "apps/infotainment screen, not the 3D car rig" },
  { match: (p) => p.startsWith("comms."), reason: "phone/comms UI, not the 3D car rig" },
  { match: (p) => p.startsWith("system."), reason: "HMI unit conventions (12H/24H, mile/km), not the 3D car rig" },
];

export function isMapped(p: string): boolean {
  return MAPPED.some((mp) => mp.match(p));
}
export function ignoreReason(p: string): string | null {
  return KNOWN_UNRENDERED.find((ig) => ig.match(p))?.reason ?? null;
}
export function classify(p: string): "mapped" | "ignored" | "unclassified" {
  if (isMapped(p)) return "mapped";
  return ignoreReason(p) ? "ignored" : "unclassified";
}

/** The current error-level console lines (should be empty for a non-rejected turn). */
export function errorLines(): string[] {
  return getAgentState()
    .consoleLog.filter((e) => e.level === "error")
    .map((e) => e.text);
}

/**
 * Assert the full (a)+(b)+(c) contract for a set of emitted paths against the current
 * renderer mirror + UI state. `rejected` relaxes (a) for a genuine `rejected` outcome
 * (allowed to be error-level). Shared by the in-process and live regressions.
 */
export function assertContract(
  mirror: Record<string, string>,
  paths: Iterable<string>,
  opts: { rejected: boolean },
): void {
  const pathList = [...paths];

  // (a) zero error-level output for a non-rejected turn.
  if (!opts.rejected) expect(errorLines()).toEqual([]);

  // (b) each mapped path emitted → its oracle asserts getState()/getMusic() reflects it.
  const ran = new Set<string>();
  for (const p of pathList) {
    for (const mp of MAPPED) {
      if (mp.match(p) && !ran.has(mp.id)) {
        ran.add(mp.id);
        mp.check(mirror);
      }
    }
  }

  // (c) every emitted path is mapped or explicitly ignore-listed.
  const unclassified = pathList.filter((p) => classify(p) === "unclassified");
  expect(unclassified, `unclassified emitted paths: ${unclassified.join(", ")}`).toEqual([]);
}
