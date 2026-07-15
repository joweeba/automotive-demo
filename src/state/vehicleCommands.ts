import {
  getState,
  setState,
  TEMP_MIN,
  TEMP_MAX,
  EXT_TEMP_MIN,
  EXT_TEMP_MAX,
} from "./vehicleState";
import type {
  CameraView,
  Climate,
  TriState,
  SeatId,
  SeatLevel,
  Weather,
} from "./vehicleState";

// ---------------------------------------------------------------------------
// vehicleCommands — the canonical, named command vocabulary.
//
// This is the ONLY way the vehicle state is mutated. The sidebar calls these
// directly; the future LLM tool-calling layer will be a thin adapter that
// exposes each of these as a tool. Keep them plain (no React) so the viewer
// and the agent can call them too.
// ---------------------------------------------------------------------------

export function setCameraView(view: CameraView): void {
  setState({ view });
}

// --- Environment (the outside world; drives every Auto setting) ---

export function setExternalTemp(externalTemp: number): void {
  const clamped = Math.max(EXT_TEMP_MIN, Math.min(EXT_TEMP_MAX, Math.round(externalTemp)));
  setState({ environment: { ...getState().environment, externalTemp: clamped } });
}

export function stepExternalTemp(delta: number): void {
  setExternalTemp(getState().environment.externalTemp + delta);
}

export function setWeather(weather: Weather): void {
  setState({ environment: { ...getState().environment, weather } });
}

/** Cycle the weather clear → rain → fog → clear (environment display click). */
export function cycleWeather(): void {
  const order: Weather[] = ["clear", "rain", "fog"];
  const next = order[(order.indexOf(getState().environment.weather) + 1) % order.length];
  setWeather(next);
}

export function setClimate(climate: Climate): void {
  setState({ climate });
}

export function setTemperature(temperature: number): void {
  const clamped = Math.max(TEMP_MIN, Math.min(TEMP_MAX, Math.round(temperature)));
  setState({ temperature: clamped });
}

export function stepTemperature(delta: number): void {
  setTemperature(getState().temperature + delta);
}

export function setFan(on: boolean): void {
  setState({ fan: on });
}

export function setRecirculation(on: boolean): void {
  setState({ recirculation: on });
}

export function setSeatHeat(seat: SeatId, level: SeatLevel): void {
  setState({ seatHeat: { ...getState().seatHeat, [seat]: level } });
}

/** Cycle a seat through 0 → 1 → 2 → 3 → 0 (sidebar button behavior). */
export function cycleSeatHeat(seat: SeatId): void {
  const next = ((getState().seatHeat[seat] + 1) % 4) as SeatLevel;
  setSeatHeat(seat, next);
}

export function setHeadlights(s: TriState): void {
  setState({ headlights: s });
}

export function setTaillights(s: TriState): void {
  setState({ taillights: s });
}

export function setFoglights(on: boolean): void {
  setState({ foglights: on });
}

export function setWiper(s: TriState): void {
  setState({ wiper: s });
}

export function setTrunk(open: boolean): void {
  setState({ trunk: open });
}

export function setFrunk(open: boolean): void {
  setState({ frunk: open });
}
