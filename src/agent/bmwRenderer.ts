// ---------------------------------------------------------------------------
// bmwRenderer — consume the `bmw_emulator` NDJSON renderer protocol and reflect
// it in this web 3D view.
//
// Architecture (see docs/bmw-emulator.md, or Liquid4All/assistant):
//
//   model → function-call signature → the Rust emulator GROUNDS it → mutates its
//   VehicleState → emits an NDJSON event stream → a RENDERER reflects it.
//
// The renderer is a *passive consumer*: it never executes tools. It mirrors the
// emulator's flattened VehicleState and drives the local vehicleCommands + music
// + voice-status UI so the car visibly tracks the emulator. This is the web
// equivalent of the planned Unity renderer (spec §4, Phase 4b).
//
// Event types (spec §4.5), envelope `{ v, event }`, v=1 or v=2, all values are
// JSON strings ("true"/"20"/"OPEN"):
//   snapshot     — full flattened state, always the first line
//   state_change — { changes:[{path,from,to}], state_summary }
//   animation    — { target, action, detail }  (physical actuation cue)
//   activation   — { kind, detail }             (VAD / wake / endpoint)
//   outcome      — { intent, result, reason }   (v2: the grounding verdict for a turn)
//
// This web sedan rig models a SUBSET of what a 3-series tracks. Mapped paths
// drive the car; everything else (windows, sunroof, ambient color, drive mode,
// nav, apps, comms) is surfaced in the in-panel console — nothing is silently
// dropped. See the mapping table in AGENT_TOOLBOX.md.
// ---------------------------------------------------------------------------

import {
  setClimate,
  setTemperature,
  setFan,
  setSeatHeat,
  setHeadlights,
  setTaillights,
  setExternalTemp,
} from "../state/vehicleCommands";
import type { SeatId, SeatLevel, Climate } from "../state/vehicleState";
import { getMusic, togglePlay, setVolume, setTrack, TRACKS } from "../state/musicStore";
import {
  setPhase,
  setTranscript,
  pushConsole,
  setConnection,
  noteAudioDropped,
  resetAudioDropped,
  type LogLevel,
} from "./agentStore";
import {
  nextConnectionState,
  type ConnectionState,
  type ConnectionEvent,
} from "./connection";

// The newest protocol version this renderer understands.
export const PROTOCOL_VERSION = 2;
// Versions we accept. v2 (assistant #179 + the emulator `--ui` bridge) adds the
// `outcome` event and is additive over v1 (spec §4.5: additive evolution, ignore
// unknown fields), so we still accept a v1 stream from an older emulator.
const SUPPORTED_VERSIONS = new Set([1, 2]);

/** Infer the (BMW-vocabulary-less) "heat" glow when the cabin setpoint is this warm. */
const HEAT_INFER_F = 74;

// The emulator's full 14-zone seat enum → this rig's three seat anchors
// (driver/passenger/rear). MUST cover every zone value the model can emit for a
// seat command — including the aggregates (ALL_CAR/FRONT/PASSENGERS) and the
// bare-call default ALL_CAR — or a seat command lands on no anchor and is
// silently dropped. Aggregates fan out to multiple anchors; the rig cannot split
// left/right within a row, so PASSENGER_LEFT/RIGHT collapse to the passenger anchor.
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

// ── the mirror ──────────────────────────────────────────────────────────────
// A local copy of the emulator's flattened state (canonical VehicleState::flatten
// paths → string values). Reconciled into vehicleCommands on every event.
let mirror: Record<string, string> = {};

// ── value parsing ───────────────────────────────────────────────────────────
const truthy = (v?: string) =>
  v === "true" || v === "on" || v === "ON" || v === "1";

function seatLevel(v?: string): SeatLevel {
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

/** Parse a temperature string to °F. Handles "21", "21C", "70F", "20.5".
 *  A bare value ≤ 40 is assumed Celsius (a cabin/ambient temp in °F never is). */
function parseTempF(raw?: string): number | null {
  if (raw == null) return null;
  const m = /(-?\d+(?:\.\d+)?)\s*([CF])?/i.exec(raw);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const unit = m[2]?.toUpperCase();
  if (unit === "C" || (!unit && n <= 40)) n = (n * 9) / 5 + 32;
  return n;
}

/** First present value across a subsystem's preferred zones, else any zone, else the bare key. */
function firstZone(prefix: string, zones: string[]): string | undefined {
  for (const z of zones) {
    const v = mirror[`${prefix}.${z}`];
    if (v !== undefined) return v;
  }
  const k = Object.keys(mirror).find((p) => p.startsWith(`${prefix}.`));
  return k ? mirror[k] : mirror[prefix];
}

/** True if the bare key or any per-zone key under `prefix` satisfies `pred`. */
function anyZone(prefix: string, pred: (v: string) => boolean): boolean {
  return Object.entries(mirror).some(
    ([p, v]) => (p === prefix || p.startsWith(`${prefix}.`)) && pred(v),
  );
}

// ── subsystem appliers (read the whole mirror, idempotent) ──────────────────

function applyClimate(): void {
  const tF = parseTempF(firstZone("climate.temperature", ["DRIVER", "ALL_CAR", "FRONT", "PASSENGER"]));
  if (tF != null) setTemperature(Math.round(tF));

  setFan(anyZone("climate.fan_speed", (v) => v !== "OFF" && v !== "0" && v !== ""));

  // Glow: BMW expresses heating via temperature (there is no "heat" mode intent),
  // so infer heat from a warm setpoint vs. the outside temp when AC/auto are off.
  const acOn = anyZone("climate.ac", truthy) || anyZone("climate.max_ac", truthy);
  // Emulator flatten() emits `climate.auto.<zone>` (car_toggle_climate_auto),
  // NOT `climate.climate_auto` — see docs/emulator/command-taxonomy.md.
  const autoOn = anyZone("climate.auto", truthy);
  // Read-only vehicle info flattens as `info.<PROPERTY>` in the model's UPPER_SNAKE
  // enum (docs/emulator/ui-integration-api.md), e.g. `info.EXTERIOR_TEMPERATURE`.
  const extF = parseTempF(mirror["info.EXTERIOR_TEMPERATURE"]);
  let mode: Climate = "off";
  if (acOn) mode = "ac";
  else if (autoOn) mode = "auto";
  else if (tF != null && ((extF != null && tF > extF + 2) || tF >= HEAT_INFER_F)) mode = "heat";
  setClimate(mode);

  // Seat heating: aggregate the mapped zones to the three seat anchors (take the max).
  const acc: Record<SeatId, SeatLevel> = { driver: 0, passenger: 0, rear: 0 };
  for (const [path, val] of Object.entries(mirror)) {
    if (!path.startsWith("climate.seat_heating.")) continue;
    for (const seat of ZONE_TO_SEAT[path.slice("climate.seat_heating.".length)] ?? []) {
      acc[seat] = Math.max(acc[seat], seatLevel(val)) as SeatLevel;
    }
  }
  (Object.keys(acc) as SeatId[]).forEach((seat) => setSeatHeat(seat, acc[seat]));
}

function applyLighting(): void {
  // DRIVING = low/driving beam, DAYTIME = DRLs. BMW has no separate taillight or fog
  // intent, so taillights mirror the headlights (as autoResolve does) and fog is untouched.
  const on = truthy(mirror["lighting.light.DRIVING"]) || truthy(mirror["lighting.light.DAYTIME"]);
  setHeadlights(on ? "on" : "off");
  setTaillights(on ? "on" : "off");
}

function applyMedia(): void {
  const muted = truthy(mirror["media.muted"]);
  const volRaw = mirror["media.volume"];
  if (volRaw !== undefined) {
    const v = Math.round(Number(volRaw));
    if (!Number.isNaN(v)) setVolume(muted ? 0 : v);
  } else if (muted) {
    setVolume(0);
  }
  // media_play sets a source → treat as "playing".
  if (mirror["media.source"] && !getMusic().playing) togglePlay();
  const idx = mirror["media.track_index"];
  if (idx !== undefined && !Number.isNaN(Number(idx))) setTrack(Number(idx) % TRACKS.length);
}

function applyEnvironment(): void {
  // Canonical flatten path is `info.EXTERIOR_TEMPERATURE` (UPPER_SNAKE property),
  // not `info.exterior_temp` — see docs/emulator/ui-integration-api.md.
  const extF = parseTempF(mirror["info.EXTERIOR_TEMPERATURE"]);
  if (extF != null) setExternalTemp(Math.round(extF));
  // info.DATE / info.TIME / nav.gps are environmental truth; the web demo's Auto rules
  // run off the device clock, so we mirror but don't act on them.
}

// ── event dispatch ──────────────────────────────────────────────────────────

function reconcile(paths: string[]): void {
  const subs = new Set(paths.map((p) => p.split(".")[0]));
  if (subs.has("climate")) applyClimate();
  if (subs.has("lighting")) applyLighting();
  if (subs.has("media")) applyMedia();
  if (subs.has("info") || subs.has("nav") || subs.has("system")) applyEnvironment();
  // Subsystems the web rig can't show yet — surface, don't drop (spec: no silent truncation).
  for (const p of paths) {
    const top = p.split(".")[0];
    if (top === "body" || top === "drive" || top === "apps" || top === "comms")
      pushConsole("info", `bmw: ${p}=${mirror[p]} (no web rig mapping)`);
  }
}

function onSnapshot(state: Record<string, string>): void {
  mirror = { ...state };
  pushConsole("event", `bmw ⬒ snapshot — ${Object.keys(mirror).length} state paths`);
  applyClimate();
  applyLighting();
  applyMedia();
  applyEnvironment();
}

interface Change {
  path: string;
  from?: string;
  to: string;
}

function onStateChange(changes: Change[]): void {
  const paths: string[] = [];
  for (const c of changes) {
    if (!c || typeof c.path !== "string") {
      // A malformed change entry — surface it (no silent drop) and skip just it.
      console.warn("[bmw] skipped malformed state_change entry:", c);
      pushConsole("warn", `bmw: skipped malformed change entry`);
      continue;
    }
    mirror[c.path] = c.to;
    paths.push(c.path);
    pushConsole("tool", `bmw Δ ${c.path}: ${c.from || "∅"} → ${c.to}`);
  }
  reconcile(paths);
}

function onAnimation(evt: { target?: string; action?: string; detail?: string }): void {
  // The physical-actuation cue for the turn's command; the visual change already
  // arrived via state_change, so we log it as a trace marker.
  const parts = [evt.target, evt.action].filter(Boolean).join(".");
  pushConsole("event", `bmw ⚙ ${parts}${evt.detail ? `(${evt.detail})` : ""}`);
}

function onActivation(evt: { kind?: string; detail?: string }): void {
  const kind = String(evt.kind ?? "").toLowerCase();
  const detail = evt.detail ? String(evt.detail) : "";
  pushConsole("event", `bmw ◉ activation:${kind}${detail ? ` ${detail}` : ""}`);
  if (/wake/.test(kind)) setPhase("wake");
  else if (/vad|voice|speech|activity/.test(kind)) {
    if (detail) setTranscript(detail);
    setPhase("voice");
  } else if (/asr|transcript/.test(kind)) {
    if (detail) setTranscript(detail);
    setPhase("processing");
  } else if (/endpoint|end/.test(kind)) setPhase("processing");
  else if (/idle|reset|done|silence/.test(kind)) setPhase("idle");
}

// Human-readable labels for the v2 `outcome.result` enum.
const OUTCOME_LABEL: Record<string, string> = {
  applied: "applied",
  read: "read",
  rejected: "rejected",
  not_equipped: "not equipped",
  not_implemented: "not implemented",
};

function onOutcome(evt: { intent?: string; result?: string; reason?: string }): void {
  // The v2 grounding verdict for a turn. For applied/read the visible change already
  // arrived via state_change; this surfaces WHY a command did nothing — a feature this
  // trim lacks (not_equipped) or one the emulator can't ground yet (not_implemented) —
  // so it is visible in the console instead of silently ignored.
  const intent = evt.intent ? String(evt.intent) : "(unknown)";
  const result = String(evt.result ?? "");
  const label = OUTCOME_LABEL[result] ?? result ?? "";
  const reason = evt.reason ? ` — ${String(evt.reason)}` : "";
  // Severity by outcome CLASS, not "anything that isn't applied is an error".
  //  - applied / read           → event  (the visible change already arrived)
  //  - not_equipped / not_impl. → info   (EXPECTED product states: this trim
  //                                        lacks the feature, or the head-unit UI
  //                                        doesn't cover it yet — surface, don't
  //                                        red-error, or every gated command spews)
  //  - rejected / unknown       → error  (a genuinely malformed / unmodeled call)
  const level: LogLevel =
    result === "applied" || result === "read"
      ? "event"
      : result === "not_equipped" || result === "not_implemented"
        ? "info"
        : "error";
  pushConsole(level, `bmw ⌁ outcome: ${intent} → ${label || "(no result)"}${reason}`);
}

function dispatch(evt: unknown): void {
  if (evt == null || typeof evt !== "object") {
    // Not a protocol object — surface rather than silently swallow (owner directive:
    // no silent drops). Recoverable/expected-but-notable → warn, not error.
    console.warn("[bmw] ignored non-object event:", evt);
    pushConsole("warn", `bmw: ignored non-object event (${typeof evt})`);
    return;
  }
  const e = evt as Record<string, unknown>;
  if (e.v !== undefined && !SUPPORTED_VERSIONS.has(e.v as number)) {
    pushConsole(
      "error",
      `bmw: refusing unknown protocol v=${String(e.v)} (support v=${[...SUPPORTED_VERSIONS].join("/")})`,
    );
    return;
  }
  switch (e.event) {
    case "snapshot":
      return onSnapshot((e.state as Record<string, string>) ?? {});
    case "state_change":
      return onStateChange((e.changes as Change[]) ?? []);
    case "animation":
      return onAnimation(e as { target?: string; action?: string; detail?: string });
    case "activation":
      return onActivation(e as { kind?: string; detail?: string });
    case "outcome":
      return onOutcome(e as { intent?: string; result?: string; reason?: string });
    default:
      pushConsole("event", `bmw: ignored event "${String(e.event)}"`);
  }
}

/** Feed NDJSON into the renderer: a raw line (or multi-line chunk), or a parsed event object. */
export function ingest(data: string | object): void {
  if (typeof data !== "string") return dispatch(data);
  for (const line of data.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue; // blank line — nothing to surface
    if (t[0] !== "{") {
      // Non-protocol line (e.g. interleaved emulator log). Expected-but-notable:
      // surface as a warning so it is never a silent drop (spec §4.5: lines start
      // at column 0 with '{').
      console.warn(`[bmw] ignored non-protocol line: ${t.slice(0, 80)}`);
      pushConsole("warn", `bmw: ignored non-protocol line: ${t.slice(0, 60)}`);
      continue;
    }
    try {
      dispatch(JSON.parse(t));
    } catch (err) {
      // A malformed inbound line — recoverable but notable (owner directive).
      console.warn(`[bmw] unparseable line: ${t.slice(0, 80)}`, err);
      pushConsole("warn", `bmw: unparseable line: ${t.slice(0, 80)}`);
    }
  }
}

/** Current mirror of the emulator's flattened state (read-only copy, for debugging). */
export function getMirror(): Record<string, string> {
  return { ...mirror };
}

// ── outbound: mic control + audio (bidirectional, same socket) ───────────────
// The receive path above consumes the emulator's NDJSON stream unchanged; here
// we SEND on the same socket per the shared WS protocol:
//   • Control = WS TEXT frame, JSON `{"v":2,"in":"<cmd>",...}`
//   • Audio   = WS BINARY frame, raw little-endian PCM16 mono 16 kHz, no header
// Binary frames are only meaningful between a start (mic_start/ptt_down) and its
// matching stop (mic_stop/ptt_up); the emulator enforces that, we just send.

/** The four control commands the UI can send. */
export type MicControlCmd = "mic_start" | "mic_stop" | "ptt_down" | "ptt_up";

/** Audio-format descriptor included with the "start" commands (matches the wire spec). */
export const AUDIO_FORMAT = {
  sample_rate: 16000,
  format: "pcm16le",
  channels: 1,
} as const;

/**
 * Build the JSON control message for a command (pure — unit-tested). `mic_start`
 * and `ptt_down` carry the audio-format descriptor; the stops are bare.
 */
export function buildControlMessage(cmd: MicControlCmd): Record<string, unknown> {
  const msg: Record<string, unknown> = { v: PROTOCOL_VERSION, in: cmd };
  if (cmd === "mic_start" || cmd === "ptt_down") Object.assign(msg, AUDIO_FORMAT);
  return msg;
}

/** True when the socket is present and open (safe to send). */
function socketOpen(): boolean {
  return (
    socket != null &&
    typeof WebSocket !== "undefined" &&
    socket.readyState === WebSocket.OPEN
  );
}

/**
 * Send a mic control command as a JSON TEXT frame. No-ops (drops) gracefully if
 * the socket is not open — never throws.
 */
export function sendControl(cmd: MicControlCmd): void {
  if (!socketOpen()) {
    // Recoverable/expected-but-notable: the socket isn't open, so the command can't
    // go out. Surface loudly (console.warn + UI) — NEVER a silent drop. Controls are
    // low-rate, so we log every one.
    console.warn(
      `[bmw] control "${cmd}" NOT SENT — WebSocket not open (readyState=${socket?.readyState ?? "null"}). Connect to an emulator first.`,
    );
    pushConsole("warn", `bmw: control "${cmd}" not sent — not connected`);
    return;
  }
  try {
    socket!.send(JSON.stringify(buildControlMessage(cmd)));
    console.info(`[bmw] → control ${cmd}`);
    pushConsole("tool", `bmw → ${cmd}`);
  } catch (err) {
    // A genuine send failure is an ERROR.
    console.error(`[bmw] control "${cmd}" send failed:`, err);
    pushConsole("error", `bmw: control send failed: ${String(err)}`);
  }
}

// Diagnostics: counters so we can see (in the browser console AND the UI) whether
// the worklet is producing + shipping audio, and whether anything is being dropped
// — no path silently no-ops.
let audioFrameCount = 0; // frames successfully sent
let droppedAudioFrames = 0; // frames dropped because the socket wasn't open
let idleAudioFrames = 0; // empty frames produced by the worklet
let sendAudioErrors = 0; // frames that threw on send()

/**
 * Send one frame of PCM16 audio as a BINARY frame. Drops silently if the socket
 * is not open (audio frames are high-rate; we don't log each drop). Never throws.
 */
export function sendAudio(pcm16: Int16Array): void {
  if (pcm16.length === 0) {
    // An empty/idle frame is expected-but-notable — count it so a "no audio"
    // investigation can see the worklet is producing empties rather than nothing.
    idleAudioFrames++;
    if (idleAudioFrames === 1)
      console.warn("[bmw] mic worklet produced an empty audio frame (ignored)");
    return;
  }
  if (!socketOpen()) {
    // Audio frames are high-rate; log the FIRST drop loudly and then throttle, but
    // ALWAYS reflect the running drop count in state/UI so the drop is never silent.
    droppedAudioFrames++;
    noteAudioDropped(1);
    if (droppedAudioFrames === 1 || droppedAudioFrames % 50 === 0)
      console.warn(
        `[bmw] audio frame dropped — WebSocket not open (dropped ${droppedAudioFrames}, readyState=${socket?.readyState ?? "null"})`,
      );
    return;
  }
  try {
    // Send exactly this view's bytes (respect byteOffset/length if it's a slice).
    socket!.send(pcm16.buffer.slice(pcm16.byteOffset, pcm16.byteOffset + pcm16.byteLength));
    audioFrameCount++;
    if (audioFrameCount === 1 || audioFrameCount % 25 === 0)
      console.info(`[bmw] → audio frame #${audioFrameCount} (${pcm16.length} samples)`);
  } catch (err) {
    // A send THROW (e.g. socket transitioned mid-send, buffer detached) is a real
    // error — surface it (never an empty catch). Drop only this frame; keep streaming.
    sendAudioErrors++;
    if (sendAudioErrors === 1 || sendAudioErrors % 50 === 0)
      console.error(`[bmw] audio frame send failed (${sendAudioErrors}):`, err);
  }
}

/** Reset the diagnostic audio-frame counters (call on start so the next stream re-logs). */
export function resetAudioFrameCount(): void {
  audioFrameCount = 0;
  droppedAudioFrames = 0;
  idleAudioFrames = 0;
  sendAudioErrors = 0;
  resetAudioDropped();
}

/** Read-only snapshot of the audio-frame diagnostics (for tests / debugging). */
export function getAudioDiagnostics(): {
  sent: number;
  dropped: number;
  idle: number;
  errors: number;
} {
  return {
    sent: audioFrameCount,
    dropped: droppedAudioFrames,
    idle: idleAudioFrames,
    errors: sendAudioErrors,
  };
}

/** Clear the mirror (e.g. before reconnecting to a fresh emulator). */
export function reset(): void {
  mirror = {};
}

// ── WebSocket transport ─────────────────────────────────────────────────────
// The emulator's NDJSON sink is stdout today / a socket later (spec §4.5); a tiny
// bridge (or the socket transport) forwards those lines to this WebSocket. Every
// message may carry one or many `\n`-delimited protocol lines.

let socket: WebSocket | null = null;
let wantUrl: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// The connection FSM state (mirrored into agentStore for the UI). The pure
// transition logic lives in ./connection so every transition is unit-testable.
let connState: ConnectionState = "disconnected";

/** Apply a connection lifecycle event: advance the FSM and reflect it in the UI. */
function transition(event: ConnectionEvent, reason?: string | null): ConnectionState {
  connState = nextConnectionState(connState, event);
  setConnection(connState, { url: wantUrl, reason: reason ?? null });
  return connState;
}

/** Current connection state (read-only; the UI observes the copy in agentStore). */
export function getConnectionState(): ConnectionState {
  return connState;
}

function openSocket(): void {
  if (!wantUrl || typeof WebSocket === "undefined") {
    // Can't open — surface why instead of silently no-opping.
    console.warn("[bmw] openSocket skipped — no URL or WebSocket unavailable");
    return;
  }
  const url = wantUrl;
  try {
    socket = new WebSocket(url);
  } catch (err) {
    console.error(`[bmw] WebSocket construction failed for ${url}:`, err);
    pushConsole("error", `bmw: WebSocket failed: ${String(err)}`);
    transition("error", `WebSocket failed: ${String(err)}`);
    scheduleReconnect();
    transition("close"); // no live socket → we're now reconnecting
    return;
  }
  transition("connect", `Connecting to ${url}…`);
  console.info(`[bmw] WebSocket connecting to ${url}…`);
  pushConsole("event", `bmw: connecting to ${url}…`);
  socket.onopen = () => {
    console.info(`[bmw] WebSocket OPEN ${url}`);
    pushConsole("event", `bmw: connected ${url}`);
    transition("open", null);
  };
  socket.onmessage = (ev) => {
    if (typeof ev.data === "string") ingest(ev.data);
    else {
      // Binary inbound is unexpected on this stream (the emulator sends NDJSON
      // text); surface rather than silently ignore.
      console.warn("[bmw] ignored non-string inbound WebSocket message");
      pushConsole("warn", "bmw: ignored non-string inbound message");
    }
  };
  socket.onerror = () => {
    console.error(`[bmw] WebSocket ERROR for ${url}`);
    pushConsole("error", "bmw: socket error");
    transition("error", "Socket error");
  };
  socket.onclose = () => {
    socket = null;
    if (wantUrl) {
      console.warn(`[bmw] WebSocket CLOSED ${url} — retrying`);
      pushConsole("warn", "bmw: disconnected — retrying");
      transition("close", "Disconnected — retrying");
      scheduleReconnect();
    }
  };
}

function scheduleReconnect(): void {
  if (!wantUrl || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (wantUrl) openSocket();
  }, 2000);
}

/** Connect to an emulator NDJSON WebSocket bridge; auto-reconnects until disconnect(). */
export function connect(url: string): void {
  disconnect();
  wantUrl = url;
  openSocket();
}

/** Stop consuming and cancel any reconnect. */
export function disconnect(): void {
  wantUrl = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.onclose = null; // don't treat this deliberate close as a reconnect
    socket.onerror = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.close();
    socket = null;
    pushConsole("event", "bmw: renderer disconnected");
  }
  transition("disconnect", "Not connected");
}
