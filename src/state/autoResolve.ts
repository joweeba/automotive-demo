import type { VehicleState, Climate, TriState, Weather } from "./vehicleState";

// ---------------------------------------------------------------------------
// autoResolve — maps each "Auto" setting to a concrete behaviour given the
// environment (external temp + weather) and the device clock. The stored state
// stays "auto" (the sidebar keeps showing Auto); the 3D effects read these
// resolved values so the car actually reacts. Pure functions, no React.
// ---------------------------------------------------------------------------

/** Night per the device clock: before 6am or from 7pm on. */
export function isNight(now: Date = new Date()): boolean {
  const h = now.getHours();
  return h < 6 || h >= 19;
}

const DEADBAND = 1; // °F — within this of target, Auto climate does nothing

/**
 * Auto climate compares the ambient temperature to the desired cabin target:
 * warmer outside than you want → AC (cool down); colder → Heat; close → off.
 * e.g. target 68°, outside 72° → AC.
 */
export function effectiveClimate(s: VehicleState): Climate {
  if (s.climate !== "auto") return s.climate;
  const ext = s.environment.externalTemp;
  const target = s.temperature;
  if (ext > target + DEADBAND) return "ac";
  if (ext < target - DEADBAND) return "heat";
  return "off";
}

/** Auto wiper follows the rain. */
export function effectiveWiper(s: VehicleState): "on" | "off" {
  if (s.wiper !== "auto") return s.wiper === "on" ? "on" : "off";
  return s.environment.weather === "rain" ? "on" : "off";
}

/** Auto headlights: on in fog or at night, off in clear daylight. Split out so the
 *  UI can resolve availability without a full VehicleState. */
export function resolveHeadlights(
  headlights: TriState,
  weather: Weather,
  now?: Date,
): "on" | "off" {
  if (headlights !== "auto") return headlights === "on" ? "on" : "off";
  return weather === "fog" || isNight(now) ? "on" : "off";
}

export function effectiveHeadlights(s: VehicleState, now?: Date): "on" | "off" {
  return resolveHeadlights(s.headlights, s.environment.weather, now);
}

/** Auto tail lights mirror the (resolved) headlights. */
export function effectiveTaillights(s: VehicleState, now?: Date): "on" | "off" {
  if (s.taillights !== "auto") return s.taillights === "on" ? "on" : "off";
  return effectiveHeadlights(s, now);
}

/**
 * Fog lamps: the manual toggle, OR auto-on in foggy weather. (They still only
 * cast when the headlights are effectively on — which fog also forces.)
 */
export function effectiveFoglights(s: VehicleState): boolean {
  return s.foglights || s.environment.weather === "fog";
}
