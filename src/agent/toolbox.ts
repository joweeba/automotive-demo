import {
  setCameraView,
  setClimate,
  setTemperature,
  stepTemperature,
  setFan,
  setRecirculation,
  setSeatHeat,
  setHeadlights,
  setTaillights,
  setFoglights,
  setWiper,
  setTrunk,
  setFrunk,
  setExternalTemp,
  setWeather,
} from "../state/vehicleCommands";
import { getState, TEMP_MIN, TEMP_MAX, EXT_TEMP_MIN, EXT_TEMP_MAX } from "../state/vehicleState";
import type { SeatId, SeatLevel } from "../state/vehicleState";
import {
  effectiveClimate,
  effectiveHeadlights,
  effectiveTaillights,
  effectiveFoglights,
  effectiveWiper,
  isNight,
} from "../state/autoResolve";
import {
  getMusic,
  togglePlay,
  nextTrack,
  prevTrack,
  setVolume,
  seek,
  TRACKS,
} from "../state/musicStore";

// ---------------------------------------------------------------------------
// The "toolbox" — the machine-readable tool vocabulary the LLM assistant calls.
// Each tool has a JSON-schema-ish parameter spec (so it maps cleanly onto an
// OpenAI/Anthropic function-tool) and an `invoke(args)` that runs the REAL
// vehicleCommands/music actions and returns a short confirmation string.
//
// Exposed to the integration through window.LiquidCar (see ./agentRuntime).
// The generated docs live in /AGENT_TOOLBOX.md.
// ---------------------------------------------------------------------------

export interface ToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  required?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  /** Runs the action; returns a human-readable confirmation. Throws on bad args. */
  invoke: (args: Record<string, unknown>) => string;
}

// --- small arg helpers ------------------------------------------------------

function str(args: Record<string, unknown>, key: string, allowed?: string[]): string {
  const v = args[key];
  if (typeof v !== "string") throw new Error(`"${key}" must be a string`);
  if (allowed && !allowed.includes(v))
    throw new Error(`"${key}" must be one of: ${allowed.join(", ")} (got "${v}")`);
  return v;
}
function num(args: Record<string, unknown>, key: string): number {
  const v = typeof args[key] === "string" ? Number(args[key]) : args[key];
  if (typeof v !== "number" || Number.isNaN(v)) throw new Error(`"${key}" must be a number`);
  return v;
}
function bool(args: Record<string, unknown>, key: string): boolean {
  const v = args[key];
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`"${key}" must be a boolean`);
}

const onoff = (b: boolean) => (b ? "on" : "off");

// --- the registry -----------------------------------------------------------

export const TOOLS: Tool[] = [
  // ── Camera ───────────────────────────────────────────────────────────────
  {
    name: "setCameraView",
    description: "Switch the 3D camera to a preset view of the car.",
    parameters: {
      view: {
        type: "string",
        description: "Which preset to frame.",
        enum: ["threeq", "top", "side", "cabin"],
        required: true,
      },
    },
    invoke: (a) => {
      const view = str(a, "view", ["threeq", "top", "side", "cabin"]) as never;
      setCameraView(view);
      return `Camera view set to ${view}.`;
    },
  },

  // ── Climate (interior) ─────────────────────────────────────────────────────
  {
    name: "setClimateMode",
    description:
      "Set the climate control mode. 'auto' picks heat/AC/off from the outside temperature vs the cabin target.",
    parameters: {
      mode: {
        type: "string",
        description: "Climate mode.",
        enum: ["off", "auto", "ac", "heat"],
        required: true,
      },
    },
    invoke: (a) => {
      const mode = str(a, "mode", ["off", "auto", "ac", "heat"]) as never;
      setClimate(mode);
      return `Climate set to ${mode}.`;
    },
  },
  {
    name: "setCabinTemperature",
    description: `Set the desired cabin temperature in °F (${TEMP_MIN}–${TEMP_MAX}).`,
    parameters: {
      fahrenheit: {
        type: "number",
        description: "Target cabin temperature in Fahrenheit.",
        minimum: TEMP_MIN,
        maximum: TEMP_MAX,
        required: true,
      },
    },
    invoke: (a) => {
      setTemperature(num(a, "fahrenheit"));
      return `Cabin temperature set to ${getState().temperature}°F.`;
    },
  },
  {
    name: "adjustCabinTemperature",
    description: "Nudge the cabin temperature up or down by a number of degrees (can be negative).",
    parameters: {
      delta: { type: "number", description: "Degrees to change (e.g. 2 or -3).", required: true },
    },
    invoke: (a) => {
      stepTemperature(num(a, "delta"));
      return `Cabin temperature now ${getState().temperature}°F.`;
    },
  },
  {
    name: "setFan",
    description: "Turn the cabin fan on or off (the fan drives the wind effect toward the seats).",
    parameters: { on: { type: "boolean", description: "Fan on?", required: true } },
    invoke: (a) => {
      const on = bool(a, "on");
      setFan(on);
      return `Fan turned ${onoff(on)}.`;
    },
  },
  {
    name: "setRecirculation",
    description: "Turn air re-circulation on or off.",
    parameters: { on: { type: "boolean", description: "Re-circulation on?", required: true } },
    invoke: (a) => {
      const on = bool(a, "on");
      setRecirculation(on);
      return `Re-circulation turned ${onoff(on)}.`;
    },
  },
  {
    name: "setSeatHeater",
    description: "Set a seat heater level (0 = off, 1–3 = increasing warmth).",
    parameters: {
      seat: {
        type: "string",
        description: "Which seat.",
        enum: ["driver", "passenger", "rear"],
        required: true,
      },
      level: {
        type: "number",
        description: "Heat level 0–3.",
        minimum: 0,
        maximum: 3,
        required: true,
      },
    },
    invoke: (a) => {
      const seat = str(a, "seat", ["driver", "passenger", "rear"]) as SeatId;
      const level = Math.max(0, Math.min(3, Math.round(num(a, "level")))) as SeatLevel;
      setSeatHeat(seat, level);
      return level === 0
        ? `${seat} seat heater turned off.`
        : `${seat} seat heater set to level ${level}.`;
    },
  },

  // ── Exterior lights + wipers ───────────────────────────────────────────────
  {
    name: "setHeadlights",
    description: "Set the headlights. 'auto' turns them on at night or in fog.",
    parameters: {
      mode: { type: "string", description: "Headlight mode.", enum: ["auto", "on", "off"], required: true },
    },
    invoke: (a) => {
      const mode = str(a, "mode", ["auto", "on", "off"]) as never;
      setHeadlights(mode);
      return `Headlights set to ${mode}.`;
    },
  },
  {
    name: "setTaillights",
    description: "Set the taillights. 'auto' mirrors the headlights.",
    parameters: {
      mode: { type: "string", description: "Taillight mode.", enum: ["auto", "on", "off"], required: true },
    },
    invoke: (a) => {
      const mode = str(a, "mode", ["auto", "on", "off"]) as never;
      setTaillights(mode);
      return `Taillights set to ${mode}.`;
    },
  },
  {
    name: "setFogLights",
    description: "Turn the fog lights on or off. They only cast when the headlights are on.",
    parameters: { on: { type: "boolean", description: "Fog lights on?", required: true } },
    invoke: (a) => {
      const on = bool(a, "on");
      setFoglights(on);
      return `Fog lights turned ${onoff(on)}.`;
    },
  },
  {
    name: "setWipers",
    description: "Set the windshield wipers. 'auto' runs them when it's raining.",
    parameters: {
      mode: { type: "string", description: "Wiper mode.", enum: ["auto", "on", "off"], required: true },
    },
    invoke: (a) => {
      const mode = str(a, "mode", ["auto", "on", "off"]) as never;
      setWiper(mode);
      return `Wipers set to ${mode}.`;
    },
  },

  // ── Access (trunk / frunk) ─────────────────────────────────────────────────
  {
    name: "setTrunk",
    description: "Open or close the trunk.",
    parameters: { open: { type: "boolean", description: "Open the trunk?", required: true } },
    invoke: (a) => {
      const open = bool(a, "open");
      setTrunk(open);
      return `Trunk ${open ? "opening" : "closing"}.`;
    },
  },
  {
    name: "setFrunk",
    description: "Open or close the frunk (front trunk / hood).",
    parameters: { open: { type: "boolean", description: "Open the frunk?", required: true } },
    invoke: (a) => {
      const open = bool(a, "open");
      setFrunk(open);
      return `Frunk ${open ? "opening" : "closing"}.`;
    },
  },

  // ── Environment (the outside world; drives every 'auto' setting) ───────────
  {
    name: "setOutsideTemperature",
    description: `Set the ambient outside temperature in °F (${EXT_TEMP_MIN}–${EXT_TEMP_MAX}). Drives 'auto' climate.`,
    parameters: {
      fahrenheit: {
        type: "number",
        description: "Outside temperature in Fahrenheit.",
        minimum: EXT_TEMP_MIN,
        maximum: EXT_TEMP_MAX,
        required: true,
      },
    },
    invoke: (a) => {
      setExternalTemp(num(a, "fahrenheit"));
      return `Outside temperature set to ${getState().environment.externalTemp}°F.`;
    },
  },
  {
    name: "setWeather",
    description: "Set the weather. Drives 'auto' wipers, headlights and fog lights.",
    parameters: {
      weather: { type: "string", description: "Weather.", enum: ["clear", "rain", "fog"], required: true },
    },
    invoke: (a) => {
      const weather = str(a, "weather", ["clear", "rain", "fog"]) as never;
      setWeather(weather);
      return `Weather set to ${weather}.`;
    },
  },

  // ── Music (mock Spotify player) ────────────────────────────────────────────
  {
    name: "setMusicPlaying",
    description: "Play or pause the music.",
    parameters: { playing: { type: "boolean", description: "Play (true) or pause (false)?", required: true } },
    invoke: (a) => {
      const playing = bool(a, "playing");
      if (getMusic().playing !== playing) togglePlay();
      return playing ? "Music playing." : "Music paused.";
    },
  },
  {
    name: "nextTrack",
    description: "Skip to the next track.",
    parameters: {},
    invoke: () => {
      nextTrack();
      return `Now playing “${TRACKS[getMusic().index].title}”.`;
    },
  },
  {
    name: "previousTrack",
    description: "Go to the previous track (or restart the current one if >3s in).",
    parameters: {},
    invoke: () => {
      prevTrack();
      return `Now playing “${TRACKS[getMusic().index].title}”.`;
    },
  },
  {
    name: "setMusicVolume",
    description: "Set the music/radio volume (0–100).",
    parameters: {
      level: { type: "number", description: "Volume 0–100.", minimum: 0, maximum: 100, required: true },
    },
    invoke: (a) => {
      setVolume(num(a, "level"));
      return `Volume set to ${getMusic().volume}.`;
    },
  },
  {
    name: "seekMusic",
    description: "Seek the current track to a position in seconds.",
    parameters: {
      seconds: { type: "number", description: "Position in seconds.", minimum: 0, required: true },
    },
    invoke: (a) => {
      seek(num(a, "seconds"));
      return `Seeked to ${Math.round(getMusic().position)}s.`;
    },
  },
];

/** A read-only snapshot of everything the assistant might want as context. */
export function getVehicleSnapshot() {
  const s = getState();
  const m = getMusic();
  return {
    view: s.view,
    environment: { ...s.environment, isNight: isNight() },
    interior: {
      climate: s.climate,
      climateEffective: effectiveClimate(s),
      temperature: s.temperature,
      fan: s.fan,
      recirculation: s.recirculation,
      seatHeat: { ...s.seatHeat },
    },
    exterior: {
      headlights: s.headlights,
      headlightsEffective: effectiveHeadlights(s),
      taillights: s.taillights,
      taillightsEffective: effectiveTaillights(s),
      foglights: s.foglights,
      foglightsEffective: effectiveFoglights(s),
      wiper: s.wiper,
      wiperEffective: effectiveWiper(s),
      trunk: s.trunk,
      frunk: s.frunk,
    },
    music: {
      playing: m.playing,
      track: TRACKS[m.index].title,
      artist: TRACKS[m.index].artist,
      volume: m.volume,
      positionSec: Math.round(m.position),
    },
  };
}
