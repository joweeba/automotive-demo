# Automotive Assistant Demo

A web UI demo for an automotive client: an on-device **Liquid** AI assistant controlling a
3D sedan. A rigged GLB renders center stage; a Tidal control sidebar and a "Liquid agent"
chat drive named animations and effect overlays on the car (climate glow, wind washes,
seat-heat sprites, head/tail/fog light beams, doors/trunk/frunk, camera presets…).

Built with **Vite + React + react-three-fiber + Tidal** (Liquid AI's design system).

---

## Quick start

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
npm run build      # type-check + production build
npm run typecheck
```

Everything is driven by a single source-of-truth state object; the sidebar controls and
the assistant mutate it through the **same** named command layer, so the car reacts
identically whether a knob or the model drives it.

---

## Connecting an LLM assistant

The whole point of the state/command architecture is that **an LLM can drive every control
the UI can**. The app exposes one global bridge, **`window.LiquidCar`**, that your
assistant hooks into. There is no build step or SDK to wire up — it's available on `window`
as soon as the app mounts.

> **Full API reference + every tool's parameters: [`AGENT_TOOLBOX.md`](./AGENT_TOOLBOX.md).**

### How the toolkit works

```
Sidebar controls ─┐
Agent chat        ├─►  vehicleCommands  ─►  vehicleState (single source of truth)  ─►  3D viewer
Your LLM ─────────┘        ▲
                           │
   window.LiquidCar.invoke(name, args)  ──►  toolbox.ts  (wraps each command as a tool
                                              with a JSON-schema param spec + validation)
```

- **`src/state/vehicleCommands.ts`** — the canonical named command vocabulary; the only way
  state is mutated.
- **`src/agent/toolbox.ts`** — wraps each command as a **tool** with a JSON-schema-style
  parameter spec, validation, and a human-readable result string. This is the LLM tool surface.
- **`src/agent/agentRuntime.ts`** — installs **`window.LiquidCar`**: the tool manifest,
  `invoke()`, a read-only state snapshot, and helpers to drive the chat transcript and the
  voice-status UI.

### The bridge at a glance

```js
window.LiquidCar.version                       // "1.1.0"
window.LiquidCar.tools                          // [{ name, description, parameters }, …] — 20 tools
window.LiquidCar.invoke("setClimateMode", { mode: "heat" })  // → "Climate set to heat."
window.LiquidCar.getState()                     // read-only snapshot (incl. resolved 'auto' values)
window.LiquidCar.subscribe(cb)                  // → unsubscribe()

window.LiquidCar.chat.{ open, close, userMessage, respond, setTranscript }
window.LiquidCar.agent.{ setPhase, muteMic, unmuteMic, setMicMuted, log, clearLog }
window.LiquidCar.render.{ connect, ingest, snapshot, stateChange, animation, activation }  // ← BMW emulator
```

### Two integration models

Pick based on **where the vehicle state lives**:

- **Direct tool-calling** — this app owns the state; your model calls `invoke(tool, args)`
  and the car mutates. Best for a standalone browser demo. (The rest of this section.)
- **BMW emulator renderer** — the [`bmw_emulator`](https://github.com/Liquid4All/assistant/blob/main/docs/bmw-emulator.md)
  owns the state: it grounds the model's `bmw_new` commands, mutates **its** `VehicleState`,
  and **pushes** the NDJSON event stream (`snapshot`/`state_change`/`animation`/`activation`,
  spec §4.5). This app is a passive **renderer** of that stream — the web equivalent of the
  planned Unity renderer. You don't call `invoke`; you feed the stream:

  ```js
  window.LiquidCar.render.connect("ws://localhost:8787");   // a bridge forwarding the emulator's NDJSON sink
  // …or open the page with ?emulator=ws://localhost:8787 to auto-connect.
  ```

  Full event handling, the BMW-path→3D mapping table, and the Celsius/zone handling are in
  [`AGENT_TOOLBOX.md` §5](./AGENT_TOOLBOX.md#5-bmw-emulator-renderer-liquidcarrender).

### Multi-brand (BMW / Mercedes) — configuration over code

The renderer is **brand-config driven** (`src/brands/{bmw,mercedes}`). The same NDJSON
pipeline renders either cabin; a brand is a `BrandConfig` (vehicle label, wake-word display,
zone set, zone→seat-anchor table, outcome handling), selected at runtime:

- `?brand=bmw` | `?brand=mercedes` **pins** the brand (authoritative — the demo selector).
- Absent, the renderer **auto-detects** from the live stream (Mercedes' W1K VIN + lowercase
  MBIS zone keys) and falls back to **BMW** (default).

Launch the **Mercedes** demo (from the [`assistant`](https://github.com/Liquid4All/assistant) repo for the emulator):

```bash
# 1) emulator → Mercedes EQS cabin, MBIS vocabulary, WebSocket bridge on :8787
cargo run -p emulator --features ui -- \
  brand_profiles/mercedes/profile.kv \
  --vehicle-profile emulator_profiles/mercedes_eqs/vehicle.kv --ui

# 2) this app
npm run dev

# 3) open (pins Mercedes + auto-connects to the bridge)
#    http://localhost:5173/?brand=mercedes&emulator=ws://localhost:8787
```

Swap the two profile args for `brand_profiles/bmw/…` + `emulator_profiles/bmw_3series/…`
(and `?brand=bmw`) for the BMW cabin. What renders vs. shows a "not available on this
vehicle" affordance is driven entirely by the emulator's per-turn `outcome` class
(`applied`/`read`/`not_implemented`/`cloud_deferred`/`rejected`) — the MBIS slice-1 cabin
returns mostly `not_implemented` today (climate grounding lands separately), and every
class is surfaced, never dropped. The Mercedes regression corpus + its generator live in
`test/fixtures/mercedes/` and `tools/gen_mercedes_golden.py`.

### Wiring it to a model (tool-calling loop)

1. **Register the tools.** Map `LiquidCar.tools` onto your provider's function-tool schema.
   Each entry is `{ name, description, parameters }`, where `parameters` is a map of
   `{ type, description, enum?, minimum?, maximum?, required? }` — a near-drop-in for
   OpenAI/Anthropic tool definitions.

   ```js
   // Anthropic example
   const tools = window.LiquidCar.tools.map((t) => ({
     name: t.name,
     description: t.description,
     input_schema: {
       type: "object",
       properties: t.parameters,
       required: Object.entries(t.parameters)
         .filter(([, p]) => p.required)
         .map(([k]) => k),
     },
   }));
   ```

2. **On each tool call the model emits, run it and feed the result back:**

   ```js
   const result = window.LiquidCar.invoke(call.name, call.input); // runs the real action, returns a string
   // → return `result` to the model as the tool_result for `call`
   ```

   `invoke` validates arguments, mutates the car (it visibly reacts), returns a confirmation
   string, and **throws** with a clear message on an unknown tool or bad input.

3. **Give the model context** with `window.LiquidCar.getState()` (current + resolved settings).

### Driving the chat + voice UI (optional but recommended)

Post the conversation into the panel and animate the voice-pipeline states:

```js
const LC = window.LiquidCar;
LC.chat.open();

LC.agent.setPhase("wake");                        // "Wake word detected" — pulse ring
LC.agent.setPhase("voice");                        // "Listening…" — live waveform (VAD)
LC.chat.setTranscript("keep the kids warm…");      // partial transcript under the modal

LC.agent.setPhase("processing");                   // "Thinking…" — bouncing dots
LC.chat.userMessage("The kids are sleeping in the back, keep them warm.");

const results = [
  LC.invoke("setClimateMode", { mode: "heat" }),
  LC.invoke("setSeatHeater", { seat: "rear", level: 2 }),
];

LC.agent.setPhase("speaking");                     // "Speaking…" — waveform
LC.chat.respond({
  text: "Got it — warming the cabin and the back seats.",
  toolLabel: `Tool call (${results.length})`,
  toolResults: results,                            // shown in the collapsible tool block
  final: "The heat is on. Anything else?",
  duration: "7.0k tokens · 1m20s · 44.5 tok/s",
});
LC.agent.setPhase("idle");                         // hide the status modal
```

Voice phases: `idle | wake | voice | processing | speaking` — each animates a status modal.
Every `invoke(...)` is auto-logged to the in-panel console (toggle it with the terminal
icon in the chat header) so you get a live trace of what the assistant did.

### What ships vs. what you wire up

- **Shipped:** the full tool surface, the car, the chat panel, the voice-status UI + console,
  and a mock Spotify player. A scripted demo (`src/agent/scripts.ts`) fires the real tools
  for the "keep the kids warm" utterance so you can see it end-to-end.
- **You provide:** the actual model + audio pipeline (ASR / wake word / VAD / TTS). Replace
  the scripted `resolveScript` path with a real tool-calling loop against `LiquidCar`.

---

## Tools at a glance

Climate/interior · camera · exterior lights · wipers · trunk/frunk · environment
(outside temp + weather, which drive every `auto` setting) · music (play/pause, next/prev,
**volume**, seek). Full signatures and examples: **[`AGENT_TOOLBOX.md`](./AGENT_TOOLBOX.md)**.

---

## Project layout

- `public/models/sedan_animated_gray.glb` — the rigged model (see `CLAUDE.md` for the rig contract).
- `reference/sedan_demo_viewer.html` — the single-file behavior reference (the app is ported from it).
- `src/state/` — `vehicleState` (store), `vehicleCommands` (command vocabulary), `autoResolve` (auto rules), `musicStore`.
- `src/agent/` — `toolbox` (tool registry), `agentRuntime` (`window.LiquidCar`), `agentStore` + `scripts` (chat).
- `src/viewer/` — the r3f scene + per-effect hooks. `src/ui/` — the Tidal UI shell + agent panel.

**`CLAUDE.md`** is the deep architecture / rig / effects reference — read it first for how
the 3D behaviors bind to the GLB.
