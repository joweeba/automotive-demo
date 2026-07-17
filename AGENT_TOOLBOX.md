# LiquidCar — Agent Integration Toolbox

The demo exposes a single global JS bridge, **`window.LiquidCar`**, for wiring an
LLM assistant to the car. It has three parts:

1. **Tools** — the callable vocabulary (set A/C, seat heaters, lights, radio volume…),
   each with a JSON-schema parameter spec you can map straight onto a function-calling tool.
2. **State** — a read-only snapshot of the vehicle + environment + music (incl. resolved
   `auto` values) and a change subscription.
3. **UI hooks** — drive the chat transcript and the voice-status UI (mic mute, wake word /
   voice activity / processing / speaking modals, and a console log).

Everything is available synchronously once the app has mounted:

```js
window.LiquidCar.version          // "1.1.0"
window.LiquidCar.tools            // tool manifest (array)
window.LiquidCar.invoke(name,args)// run a tool → confirmation string
window.LiquidCar.getState()       // read-only snapshot
window.LiquidCar.subscribe(cb)    // → unsubscribe()
window.LiquidCar.chat             // { open, close, userMessage, respond, setTranscript }
window.LiquidCar.agent            // { setPhase, muteMic, unmuteMic, setMicMuted, log, clearLog }
window.LiquidCar.render           // consume the bmw_emulator NDJSON stream (see §5)
```

> The tools ARE the trigger vocabulary — the same named commands the sidebar UI calls, so
> the car reacts identically whether a knob or the assistant drives it.

### Two ways to drive the car

There are two integration models, and you pick based on where the vehicle state lives:

1. **Direct tool-calling** (§1) — *this web app owns the state.* Your model calls
   `LiquidCar.invoke(tool, args)` and the car mutates. Best for a standalone browser demo
   with no emulator.
2. **NDJSON renderer** (§5) — *the [`bmw_emulator`](https://github.com/Liquid4All/assistant/blob/main/docs/bmw-emulator.md)
   owns the state.* The emulator grounds the model's `bmw_new` commands, mutates **its**
   `VehicleState`, and **pushes** state-change events; this app is a passive **renderer**
   that reflects them (the web equivalent of the planned Unity renderer). Use this when the
   assistant is wired to the real emulator. In this mode you don't call `invoke` — the
   emulator does the grounding and the car just tracks the stream.

---

## 1. Tools

Enumerate them at runtime with `window.LiquidCar.tools` (each entry is
`{ name, description, parameters }`, where `parameters` is a map of
`{ type, description, enum?, minimum?, maximum?, required? }`). Convert that map to your
provider's tool schema. Call one with:

```js
LiquidCar.invoke("setClimateMode", { mode: "heat" });
// → "Climate set to heat."   (also appended to the console log)
```

`invoke` validates args, runs the real action, returns a short confirmation string, and
**throws** on an unknown tool or bad arguments.

### Climate & interior
| Tool | Parameters | Notes |
|---|---|---|
| `setCameraView` | `view`: `threeq \| top \| side \| cabin` | 3D camera preset |
| `setClimateMode` | `mode`: `off \| auto \| ac \| heat` | `auto` resolves from outside temp vs cabin target |
| `setCabinTemperature` | `fahrenheit`: number 60–85 | desired cabin target |
| `adjustCabinTemperature` | `delta`: number | relative nudge (e.g. `-2`) |
| `setFan` | `on`: boolean | fan drives the wind effect |
| `setRecirculation` | `on`: boolean | |
| `setSeatHeater` | `seat`: `driver \| passenger \| rear`, `level`: 0–3 | 0 = off |

### Exterior lights & wipers
| Tool | Parameters | Notes |
|---|---|---|
| `setHeadlights` | `mode`: `auto \| on \| off` | `auto` = on at night/fog |
| `setTaillights` | `mode`: `auto \| on \| off` | `auto` mirrors headlights |
| `setFogLights` | `on`: boolean | only casts when headlights are on |
| `setWipers` | `mode`: `auto \| on \| off` | `auto` = on when raining |
| `setTrunk` | `open`: boolean | |
| `setFrunk` | `open`: boolean | front trunk / hood |

### Environment (the outside world — drives every `auto` setting)
| Tool | Parameters | Notes |
|---|---|---|
| `setOutsideTemperature` | `fahrenheit`: number 20–110 | drives `auto` climate |
| `setWeather` | `weather`: `clear \| rain \| fog` | drives `auto` wipers/lights/fog |

### Music (mock Spotify player)
| Tool | Parameters | Notes |
|---|---|---|
| `setMusicPlaying` | `playing`: boolean | play / pause |
| `nextTrack` | — | |
| `previousTrack` | — | restarts current if >3s in |
| `setMusicVolume` | `level`: number 0–100 | "lower the radio volume" |
| `seekMusic` | `seconds`: number ≥ 0 | |

---

## 2. State

```js
LiquidCar.getState()
```

returns a snapshot (values are the stored setting; `*Effective` fields are the resolved
`auto` result the 3D scene actually shows):

```jsonc
{
  "view": "threeq",
  "environment": { "externalTemp": 72, "weather": "rain", "isNight": false },
  "interior": {
    "climate": "auto", "climateEffective": "ac",
    "temperature": 72, "fan": true, "recirculation": true,
    "seatHeat": { "driver": 1, "passenger": 0, "rear": 1 }
  },
  "exterior": {
    "headlights": "auto", "headlightsEffective": "off",
    "taillights": "auto", "taillightsEffective": "off",
    "foglights": true, "foglightsEffective": true,
    "wiper": "auto", "wiperEffective": "on",
    "trunk": false, "frunk": false
  },
  "music": { "playing": true, "track": "Neon Horizon", "artist": "Soleil", "volume": 60, "positionSec": 12 }
}
```

Subscribe to any change (vehicle, music, or agent UI):

```js
const off = LiquidCar.subscribe(() => render(LiquidCar.getState()));
// later: off();
```

---

## 3. Driving the chat transcript

The assistant owns the wording; post messages into the panel:

```js
LiquidCar.chat.open();                       // show the chat panel
LiquidCar.chat.userMessage("keep the kids warm");   // user bubble

// ...run tools...
const r1 = LiquidCar.invoke("setClimateMode", { mode: "heat" });
const r2 = LiquidCar.invoke("setSeatHeater", { seat: "rear", level: 2 });

LiquidCar.chat.respond({
  text: "Sure — turning on the heat and warming the back seats.",
  toolLabel: "Tool call (2)",
  toolResults: [r1, r2],       // shown in the collapsible tool block
  final: "Done. Anything else?",
  duration: "7.0k tokens · 1m20s · 44.5 tok/s",
});
```

- `chat.setTranscript(text)` shows a live (partial) transcript under the status modal.

---

## 4. Voice-status UI + console

Drive the animated status modal from your audio pipeline:

```js
LiquidCar.agent.setPhase("wake");        // "Wake word detected" — pulse ring
LiquidCar.agent.setPhase("voice");       // "Listening…" — live waveform (VAD)
LiquidCar.chat.setTranscript("keep the kids…");   // partial transcript
LiquidCar.agent.setPhase("processing");  // "Thinking…" — bouncing dots
LiquidCar.agent.setPhase("speaking");    // "Speaking…" — waveform
LiquidCar.agent.setPhase("idle");        // hide the modal
```

Phases: `idle | wake | voice | processing | speaking`.

Mic + console:

```js
LiquidCar.agent.muteMic();               // reflects in the header + forces phase → idle
LiquidCar.agent.unmuteMic();
LiquidCar.agent.setMicMuted(true);

LiquidCar.agent.log("VAD: speech start");        // info line in the console panel
LiquidCar.agent.log("429 from ASR", "error");    // levels: event | tool | info | error
LiquidCar.agent.clearLog();
```

Every `invoke(...)` is auto-logged to the console (tool level), so opening the console
(the terminal icon in the panel header) gives a live trace of what the assistant did.

---

## End-to-end example

```js
const LC = window.LiquidCar;
LC.chat.open();
LC.agent.unmuteMic();

LC.agent.setPhase("wake");
LC.agent.setPhase("voice");
LC.chat.setTranscript("The kids are sleeping in the back, keep them warm.");

LC.agent.setPhase("processing");
LC.chat.userMessage("The kids are sleeping in the back, keep them warm.");

const results = [
  LC.invoke("setClimateMode", { mode: "heat" }),
  LC.invoke("setCabinTemperature", { fahrenheit: 72 }),
  LC.invoke("setSeatHeater", { seat: "rear", level: 2 }),
];

LC.agent.setPhase("speaking");
LC.chat.respond({
  text: "Got it — warming the cabin and the back seats.",
  toolLabel: `Tool call (${results.length})`,
  toolResults: results,
  final: "The heat is on. Let me know if you need anything else.",
  duration: "7.0k tokens · 1m20s · 44.5 tok/s",
});
LC.agent.setPhase("idle");
```

---

## 5. BMW emulator renderer (`LiquidCar.render`)

When the assistant is wired to the [`bmw_emulator`](https://github.com/Liquid4All/assistant/blob/main/docs/bmw-emulator.md),
the emulator is the source of truth: it validates the model's `bmw_new` signature, grounds
it into a `StateDelta`, mutates its own `VehicleState`, and emits the **NDJSON renderer
protocol** (spec §4.5). This app **consumes** that stream and reflects it in the 3D car —
it's the web sibling of the Unity renderer. You feed the stream in; you do **not** call
`invoke`.

### Connecting

```js
// A) Live: connect to a WebSocket bridge that forwards the emulator's NDJSON sink.
LiquidCar.render.connect("ws://localhost:8787");   // auto-reconnects until disconnect()
LiquidCar.render.disconnect();

// A') Or open the page with a query param — it auto-connects on mount:
//     http://localhost:5173/?emulator=ws://localhost:8787

// B) Transport-agnostic: feed lines yourself (from a WS, SSE, postMessage, a file replay…).
//    Accepts a raw NDJSON line, a multi-line chunk, or an already-parsed event object.
LiquidCar.render.ingest('{"v":1,"event":"state_change","changes":[{"path":"media.volume","from":"20","to":"45"}]}');

// C) Typed convenience wrappers (build the v1 envelope for you):
LiquidCar.render.snapshot({ "climate.temperature.DRIVER": "21", "media.volume": "20" });
LiquidCar.render.stateChange([{ path: "climate.seat_heating.REAR_LEFT", from: "OFF", to: "HIGH" }]);
LiquidCar.render.animation({ target: "window", action: "OPEN", detail: "DRIVER" });
LiquidCar.render.activation({ kind: "wake_word", detail: "hey bmw" });

LiquidCar.render.getState();          // read-only copy of the mirrored flattened state
LiquidCar.render.protocolVersion;     // 1 (refuses events with any other `v`)
```

> The emulator's stdout mixes human output with protocol lines; the bridge should forward
> only lines that start with `{` (per spec §4.5). `ingest` also filters defensively.

### The four events (spec §4.5)

| event | handled by the renderer |
|---|---|
| `snapshot` | replaces the mirror with the full flattened state, then reflects it. Always the stream's first line. |
| `state_change` | applies each `{path, from, to}` to the mirror, re-derives the affected subsystems, logs each delta. Empty deltas are suppressed upstream. |
| `animation` | logged as a trace marker (the visual change already arrived via `state_change`). |
| `activation` | drives the voice-status modal: `wake*`→wake, `vad/voice/speech`→voice (+transcript), `asr/transcript`→processing (+transcript), `endpoint`→processing, `idle/reset/silence`→idle. |

### State-path → 3D mapping

The web sedan rig models a **subset** of what a 3-series tracks. Mapped paths drive the car;
everything else is surfaced in the in-panel **console** (`… (no web rig mapping)`) — nothing
is silently dropped. Values arrive as strings; temperatures auto-convert (a bare value ≤ 40
or a `…C` suffix is treated as Celsius → °F). Zones collapse to three seat anchors
(`DRIVER/FRONT_LEFT`→driver, `PASSENGER/FRONT_RIGHT`→passenger, `REAR_*/THIRD_ROW/BACK`→rear).

| BMW flattened path | → web effect |
|---|---|
| `climate.temperature.<zone>` | cabin temperature (°F; prefers `DRIVER`) |
| `climate.ac.<zone>` / `climate.max_ac.<zone>` | climate glow → **AC** (blue) |
| `climate.auto.<zone>` | climate mode → **auto** |
| `climate.fan_speed.<zone>` | **fan** on when any zone ≠ `OFF`/`0` (drives the wind wash) |
| `climate.seat_heating.<zone>` | seat-heat sprite `OFF/LOW/MED/HIGH` → level `0/1/2/3` (max across mapped zones) |
| `lighting.light.DRIVING` / `.DAYTIME` | head + tail light beams + emissive lamps |
| `media.volume` / `media.muted` | player volume (mute → 0) |
| `media.source` | sets the player "playing" |
| `media.track_index` | selects the track (mod playlist length) |
| `info.EXTERIOR_TEMPERATURE` | outside temperature (drives the Auto rules) |
| `feature.<name>` | generic **Active Features** panel entry (name + on/off/value) — the long-tail channel |

**The generic `feature.<name>` channel.** The emulator grounds the long tail of cabin
features (the ones the typed schema above doesn't model — e.g. `feature.ambientLight=on`,
`feature.massage=on`, `feature.seatHeating=HIGH`, `feature.soundWorld=fireplace`) onto a
single generic channel. These are rendered **data-driven** in the on-screen **Active
Features** panel (`src/ui/ActiveFeaturesPanel.tsx`, backed by `src/state/featureStore.ts`):
name + on/off/value, humanized. An **unknown** feature name still renders generically — it
is never dropped and never logged as an error. In the shared UI contract (`test/uiContract.ts`)
`feature.*` is **MAPPED** (to the panel), not ignore-listed — so a grounded feature is
covered by the same "no silent drop" oracle as every 3D affordance. This channel is
brand-agnostic (BMW + Mercedes flow through the same path).

**Inferred:** the `bmw_new` vocabulary has **no "heat" mode** (heating is expressed via a
warmer temperature setpoint), so the red **heat** glow is inferred when AC/auto are off and
the cabin target is above the outside temp (or ≥ 74 °F). Tune `HEAT_INFER_F` in
`src/agent/bmwRenderer.ts`.

**Not yet mapped** (logged, not shown): windows/sunroof/blinds/mirrors (`body.*`), ambient
color & non-driving light types (`lighting.*`), drive mode/parking/ACC (`drive.*`),
navigation (`nav.*`), apps (`apps.*`), comms (`comms.*`), seat cooling, steering-wheel heat,
massage, defrost, recirculation, climate sync. The rig has a couple of extras the BMW
vocabulary doesn't command (trunk/frunk/wipers) — harmless; they stay UI/demo-only.

### Example — a grounded "keep the kids warm" turn

```
{"v":1,"event":"snapshot","state":{"climate.temperature.DRIVER":"21","climate.seat_heating.REAR_LEFT":"OFF","info.EXTERIOR_TEMPERATURE":"14","media.volume":"20", …}}
{"v":1,"event":"state_change","changes":[{"path":"climate.temperature.DRIVER","from":"21","to":"24"},{"path":"climate.seat_heating.REAR_LEFT","from":"OFF","to":"HIGH"}],"state_summary":"temp[DRIVER]=24C | seat_heat[REAR_LEFT]=HIGH"}
{"v":1,"event":"animation","target":"seat_heating","action":"HIGH","detail":"REAR_LEFT"}
```

→ cabin warms to 75 °F, the heat glow turns on, and the rear seat-heat sprite goes to level 3.
