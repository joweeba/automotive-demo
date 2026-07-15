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
window.LiquidCar.version          // "1.0.0"
window.LiquidCar.tools            // tool manifest (array)
window.LiquidCar.invoke(name,args)// run a tool → confirmation string
window.LiquidCar.getState()       // read-only snapshot
window.LiquidCar.subscribe(cb)    // → unsubscribe()
window.LiquidCar.chat             // { open, close, userMessage, respond, setTranscript }
window.LiquidCar.agent            // { setPhase, muteMic, unmuteMic, setMicMuted, log, clearLog }
```

> The tools ARE the trigger vocabulary — the same named commands the sidebar UI calls, so
> the car reacts identically whether a knob or the assistant drives it.

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
