import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Vehicle state — the single source of truth for the whole demo.
// Both the sidebar controls and (later) the LLM agent mutate this exclusively
// through the commands in ./vehicleCommands. The 3D viewer reads from it.
// ---------------------------------------------------------------------------

export type CameraView = "threeq" | "top" | "side" | "cabin";
export type Climate = "off" | "auto" | "ac" | "heat";
export type TriState = "auto" | "on" | "off"; // head/tail lights, wiper
export type SeatId = "driver" | "passenger" | "rear";
export type SeatLevel = 0 | 1 | 2 | 3;
export type Weather = "clear" | "rain" | "fog";

/** The surface the car sits on. Each maps to a procedural PBR material + a
 *  reflection strength (see src/viewer/groundMaterials.ts). "none" hides the ground
 *  entirely — the car floats on the dark backdrop. */
export type GroundId = "none" | "asphalt" | "dirt" | "marble" | "concrete";
export const GROUND_ORDER: GroundId[] = ["none", "asphalt", "dirt", "marble", "concrete"];
export const GROUND_LABELS: Record<GroundId, string> = {
  none: "None",
  asphalt: "Road",
  dirt: "Dirt",
  marble: "Marble",
  concrete: "Concrete",
};

/** The outside world. Drives every "Auto" setting (see ./autoResolve). Day/night
 *  is not stored — it's read from the device clock at resolution time. */
export interface Environment {
  externalTemp: number; // °F, ambient outside the car
  weather: Weather;
}

export interface VehicleState {
  view: CameraView;
  ground: GroundId; // the surface the car is parked on
  environment: Environment;
  // Interior
  climate: Climate;
  temperature: number; // °F — the desired cabin target
  fan: boolean;
  recirculation: boolean;
  seatHeat: Record<SeatId, SeatLevel>;
  // Exterior
  headlights: TriState;
  taillights: TriState;
  foglights: boolean;
  wiper: TriState;
  trunk: boolean; // open?
  frunk: boolean; // open?  (hood pivot)
}

export const TEMP_MIN = 60;
export const TEMP_MAX = 85;
export const EXT_TEMP_MIN = 20;
export const EXT_TEMP_MAX = 110;

// Defaults mirror the Figma base design (frame 123:1004).
const initialState: VehicleState = {
  view: "threeq",
  ground: "none",
  environment: { externalTemp: 72, weather: "clear" },
  climate: "auto",
  temperature: 72,
  fan: true,
  recirculation: true,
  seatHeat: { driver: 1, passenger: 0, rear: 1 },
  headlights: "auto",
  taillights: "auto",
  foglights: true,
  wiper: "auto",
  trunk: false,
  frunk: false,
};

let state: VehicleState = initialState;
const listeners = new Set<() => void>();

export function getState(): VehicleState {
  return state;
}

/** Shallow-merge a patch and notify subscribers. The only mutation entry point. */
export function setState(patch: Partial<VehicleState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React hook for reading vehicle state. Pass a selector returning a primitive
 * or an existing reference (e.g. `s => s.seatHeat`) — never build a fresh
 * object inside the selector, or useSyncExternalStore will loop.
 */
export function useVehicle<T>(selector: (s: VehicleState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}
