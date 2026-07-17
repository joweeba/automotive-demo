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
import { setPhase, setTranscript, pushConsole, type LogLevel } from "./agentStore";
import { getActiveBrand, autoDetectBrand } from "../brands/brandStore";

// The newest protocol version this renderer understands.
export const PROTOCOL_VERSION = 2;
// Versions we accept. v2 (assistant #179 + the emulator `--ui` bridge) adds the
// `outcome` event and is additive over v1 (spec §4.5: additive evolution, ignore
// unknown fields), so we still accept a v1 stream from an older emulator.
const SUPPORTED_VERSIONS = new Set([1, 2]);

// The zone→seat-anchor table and the "heat"-inference threshold are now BRAND config
// (src/brands/*). The renderer reads the ACTIVE brand's config on every apply so the same
// pipeline renders BMW (uppercase bmw_new zones) or Mercedes (lowercase MBIS zones); see
// getActiveBrand() / autoDetectBrand(). Nothing brand-specific is hard-coded below.

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
  const brand = getActiveBrand();
  const tF = parseTempF(firstZone("climate.temperature", brand.tempZones));
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
  else if (tF != null && ((extF != null && tF > extF + 2) || tF >= brand.heatInferF)) mode = "heat";
  setClimate(mode);

  // Seat heating: aggregate the mapped zones to the three seat anchors (take the max).
  // The zone→anchor table is the ACTIVE brand's (BMW uppercase / Mercedes MBIS lowercase).
  const acc: Record<SeatId, SeatLevel> = { driver: 0, passenger: 0, rear: 0 };
  for (const [path, val] of Object.entries(mirror)) {
    if (!path.startsWith("climate.seat_heating.")) continue;
    for (const seat of brand.zoneToSeat[path.slice("climate.seat_heating.".length)] ?? []) {
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
  const lp = getActiveBrand().logPrefix;
  for (const p of paths) {
    const top = p.split(".")[0];
    if (top === "body" || top === "drive" || top === "apps" || top === "comms")
      pushConsole("info", `${lp}: ${p}=${mirror[p]} (no web rig mapping)`);
  }
}

function onSnapshot(state: Record<string, string>): void {
  mirror = { ...state };
  // Re-select the brand from the fresh mirror (unless `?brand=` pinned it). The snapshot
  // alone usually looks brand-neutral (engine boot default); the boot reconcile below
  // reveals the Mercedes markers. Safe to call on every snapshot (idempotent).
  autoDetectBrand(mirror);
  pushConsole("event", `${getActiveBrand().logPrefix} ⬒ snapshot — ${Object.keys(mirror).length} state paths`);
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
  const lp = getActiveBrand().logPrefix;
  for (const c of changes) {
    if (!c || typeof c.path !== "string") continue;
    mirror[c.path] = c.to;
    paths.push(c.path);
    pushConsole("tool", `${lp} Δ ${c.path}: ${c.from || "∅"} → ${c.to}`);
  }
  // The boot reconcile is where the Mercedes markers (W1K VIN, lowercase MBIS zone keys)
  // first appear, so re-detect here too (no-op when `?brand=` pinned the brand).
  autoDetectBrand(mirror);
  reconcile(paths);
}

function onAnimation(evt: { target?: string; action?: string; detail?: string }): void {
  // The physical-actuation cue for the turn's command; the visual change already
  // arrived via state_change, so we log it as a trace marker.
  const parts = [evt.target, evt.action].filter(Boolean).join(".");
  pushConsole("event", `${getActiveBrand().logPrefix} ⚙ ${parts}${evt.detail ? `(${evt.detail})` : ""}`);
}

function onActivation(evt: { kind?: string; detail?: string }): void {
  const kind = String(evt.kind ?? "").toLowerCase();
  const detail = evt.detail ? String(evt.detail) : "";
  pushConsole("event", `${getActiveBrand().logPrefix} ◉ activation:${kind}${detail ? ` ${detail}` : ""}`);
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

// Human-readable labels for the v2 `outcome.result` enum. `cloud_deferred` is the
// Mercedes/MBIS class (the request is an online/cloud capability, not a cabin action);
// BMW never emits it, so adding it here is additive and brand-safe.
const OUTCOME_LABEL: Record<string, string> = {
  applied: "applied",
  read: "read",
  rejected: "rejected",
  not_equipped: "not equipped",
  not_implemented: "not implemented",
  cloud_deferred: "cloud deferred",
};

// Outcome classes that are EXPECTED, non-error product states (surface, don't red-error).
const OUTCOME_INFO = new Set(["not_equipped", "not_implemented", "cloud_deferred"]);

function onOutcome(evt: { intent?: string; result?: string; reason?: string }): void {
  // The v2 grounding verdict for a turn. For applied/read the visible change already
  // arrived via state_change; this surfaces WHY a command did nothing — a feature this
  // trim lacks (not_equipped), one the cabin can't ground yet (not_implemented), or a
  // cloud/online request deferred off-device (cloud_deferred) — so it is visible in the
  // console instead of silently ignored.
  const intent = evt.intent ? String(evt.intent) : "(unknown)";
  const result = String(evt.result ?? "");
  const label = OUTCOME_LABEL[result] ?? result ?? "";
  const reason = evt.reason ? ` — ${String(evt.reason)}` : "";
  // Severity by outcome CLASS, not "anything that isn't applied is an error".
  //  - applied / read                            → event  (the visible change arrived)
  //  - not_equipped / not_impl. / cloud_deferred → info   (EXPECTED product states —
  //                                                 surface, don't red-error, or every
  //                                                 gated/deferred command spews)
  //  - rejected / unknown                        → error  (a genuinely malformed /
  //                                                 unmodeled / out-of-domain call)
  const level: LogLevel =
    result === "applied" || result === "read"
      ? "event"
      : OUTCOME_INFO.has(result)
        ? "info"
        : "error";
  pushConsole(level, `${getActiveBrand().logPrefix} ⌁ outcome: ${intent} → ${label || "(no result)"}${reason}`);
}

function dispatch(evt: unknown): void {
  if (evt == null || typeof evt !== "object") return;
  const e = evt as Record<string, unknown>;
  if (e.v !== undefined && !SUPPORTED_VERSIONS.has(e.v as number)) {
    pushConsole(
      "error",
      `${getActiveBrand().logPrefix}: refusing unknown protocol v=${String(e.v)} (support v=${[...SUPPORTED_VERSIONS].join("/")})`,
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
      pushConsole("event", `${getActiveBrand().logPrefix}: ignored event "${String(e.event)}"`);
  }
}

/** Feed NDJSON into the renderer: a raw line (or multi-line chunk), or a parsed event object. */
export function ingest(data: string | object): void {
  if (typeof data !== "string") return dispatch(data);
  for (const line of data.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t[0] !== "{") continue; // protocol lines start at column 0 with '{' (spec §4.5)
    try {
      dispatch(JSON.parse(t));
    } catch {
      pushConsole("error", `${getActiveBrand().logPrefix}: unparseable line: ${t.slice(0, 80)}`);
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
    console.warn(`[mic-debug] control "${cmd}" DROPPED — WebSocket not open (readyState=${socket?.readyState ?? "null"}). Did you open the UI with ?emulator=ws://localhost:8787 ?`);
    pushConsole("info", `bmw: drop control "${cmd}" (socket not open)`);
    return;
  }
  try {
    socket!.send(JSON.stringify(buildControlMessage(cmd)));
    console.info(`[mic-debug] → control ${cmd}`);
    pushConsole("tool", `bmw → ${cmd}`);
  } catch (err) {
    console.error(`[mic-debug] control send failed:`, err);
    pushConsole("error", `bmw: control send failed: ${String(err)}`);
  }
}

// Diagnostic: count audio frames sent so we can see (in the browser console)
// whether the worklet is actually producing + shipping audio, without spamming.
let audioFrameCount = 0;

/**
 * Send one frame of PCM16 audio as a BINARY frame. Drops silently if the socket
 * is not open (audio frames are high-rate; we don't log each drop). Never throws.
 */
export function sendAudio(pcm16: Int16Array): void {
  if (pcm16.length === 0) return;
  if (!socketOpen()) {
    if (audioFrameCount === 0)
      console.warn(`[mic-debug] audio frame produced but WebSocket not open — dropping (readyState=${socket?.readyState ?? "null"})`);
    return;
  }
  try {
    // Send exactly this view's bytes (respect byteOffset/length if it's a slice).
    socket!.send(pcm16.buffer.slice(pcm16.byteOffset, pcm16.byteOffset + pcm16.byteLength));
    audioFrameCount++;
    if (audioFrameCount === 1 || audioFrameCount % 25 === 0)
      console.info(`[mic-debug] → audio frame #${audioFrameCount} (${pcm16.length} samples)`);
  } catch {
    /* transient send failure — drop the frame, keep streaming */
  }
}

/** Reset the diagnostic audio-frame counter (call on stop so the next stream re-logs). */
export function resetAudioFrameCount(): void {
  audioFrameCount = 0;
}

/** Clear the mirror (e.g. before reconnecting to a fresh emulator). Deliberately does NOT
 *  touch the active brand: a `?brand=` pin (and an already auto-detected brand) must
 *  SURVIVE a reconnect — the browser reads `?brand=` only once at install. Tests that want
 *  a clean brand state call resetBrand() explicitly. autoDetectBrand() still re-selects on
 *  the next snapshot/state_change when the brand is unpinned. */
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

function openSocket(): void {
  if (!wantUrl || typeof WebSocket === "undefined") return;
  try {
    socket = new WebSocket(wantUrl);
  } catch (err) {
    pushConsole("error", `bmw: WebSocket failed: ${String(err)}`);
    scheduleReconnect();
    return;
  }
  console.info(`[mic-debug] WebSocket connecting to ${wantUrl}…`);
  pushConsole("event", `bmw: connecting to ${wantUrl}…`);
  socket.onopen = () => {
    console.info(`[mic-debug] WebSocket OPEN ${wantUrl}`);
    pushConsole("event", `bmw: connected ${wantUrl}`);
  };
  socket.onmessage = (ev) => {
    if (typeof ev.data === "string") ingest(ev.data);
  };
  socket.onerror = () => {
    console.error(`[mic-debug] WebSocket ERROR for ${wantUrl}`);
    pushConsole("error", "bmw: socket error");
  };
  socket.onclose = () => {
    socket = null;
    if (wantUrl) {
      console.warn(`[mic-debug] WebSocket CLOSED ${wantUrl} — retrying`);
      pushConsole("event", "bmw: disconnected — retrying");
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
    socket.onclose = null;
    socket.close();
    socket = null;
    pushConsole("event", "bmw: renderer disconnected");
  }
}
