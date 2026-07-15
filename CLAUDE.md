# Automotive Assistant Demo

A web UI demo for an automotive client showing an on-device AI model controlling
vehicle systems. A 3D sedan renders center stage; a control sidebar and an agent
chat drive named animations and effect overlays on the car.

**Figma (source of truth for UI):**
https://www.figma.com/design/SX66N1jmOrb0JVt66h58FH/Automotive-assistant-demo?node-id=122-1378

Figma page "V0 proposal" contains three sections:
1. **Base designs** — full app screen: car viewport (left/center) + sidebar with:
   - Camera view tabs (Top / Cabin / Side / 3/4)
   - Music profile (Spotify, song/artist, volume slider)
   - Interior: Climate control, Internal temperature (e.g. 72°), Fan,
     Re-circulation, Seat heater with **Driver / Passenger / Back row**
   - Exterior: Head lights, Tail lights, Fog lights, Windshield wiper,
     Trunk, Frunk
2. **Agent chat flow** — "Liquid agent" chat panel. Example utterance:
   *"The kids are sleeping in the back, keep them warm."*
   Designer annotations: on opening agent chat, camera view moves to top of the
   config side panel; typing input animates with shimmer; agent speech playback
   uses play/stop buttons and animates with muted + foreground text; user
   bubble is 300px wide; on completion, return to base state.
3. **3D car model states** — the car's visual states per control.

## Repo layout

- `public/models/sedan_animated_gray.glb` — THE model. Fully rigged (see below).
- `reference/sedan_demo_viewer.html` — working single-file reference
  implementation of every behavior. **Port from it; do not refactor it in
  place.** Its `CONFIG` block at the top of the script is the source of truth
  for all tuned values (colors, opacities, positions, camera presets).
- `reference/rig/sedan_hinges.json` — exact pivot positions/axes/angles.
- `reference/comps/` — the designer's Figma boards for visual acceptance.
- `assets/wind/` — climate wash textures (use as files; the reference HTML has
  them base64-embedded, which was a single-file convenience — don't copy that).
- `assets/icons/Seat_heat_icon.svg` — seat heat arrows (3 paths; level N =
  first N arrows `#F87171`, rest `#7A7A80`).

## The rig contract (sedan_animated_gray.glb)

Coordinate system: **Y up, +Z is the FRONT of the car**, X± are the sides.
Car footprint ~2.16 × 1.5 × 4.98 m centered near origin, ground at Y=0.

Animatable pivot nodes (rotate these, never the meshes directly):

| Pivot | Position | Axis | Open angle |
|---|---|---|---|
| `PIVOT_hood` | (0, 1.00, 1.18) | X | **−40°** |
| `PIVOT_trunk` | (0, 1.09, −1.80) | X | **+60°** |
| `PIVOT_door_front_L` | (0.80, 0.80, 1.18) | Y | −55° |
| `PIVOT_door_front_R` | (−0.80, 0.80, 1.18) | Y | +55° |
| `PIVOT_door_rear_L` | (0.80, 0.80, −0.11) | Y | −55° |
| `PIVOT_door_rear_R` | (−0.80, 0.80, −0.11) | Y | +55° |
| `PIVOT_wiper_L` | (0.57, 1.00, 1.21) | windshield normal | −55° sweep |
| `PIVOT_wiper_R` | (0.02, 0.99, 1.30) | windshield normal | −55° sweep |

Windshield normal: **(0, 0.902, 0.432)** (normalized). Wipers oscillate
0 → −55° → 0 about this axis.

Toggleable node groups (by name prefix):
- `ROOF_panel`, `INTERIOR_headliner` — hide/lift both for the open-cabin view
  (reference lifts +0.65 Y while fading opacity)
- `GLASS_windshield`, `GLASS_rear_window`, `DOOR_*__glass`, `DOOR_*__glass_trim`
- `DOOR_{front|rear}_{L|R}__{skin|panel|glass|mirror|mirror_trim|...}` — every
  part of a door is under its pivot; mirrors are on the front doors
- `TRUNK__lid` plus `TRUNK__taillight-*` (trunk-mounted taillight pieces ride
  the trunk pivot)
- `HOOD__panel` — opening it reveals a real modeled engine
  (`engine-parts`, `radiator`, `engine-transmission`)
- Seat meshes for icon anchoring: `front-seat` (driver), `front-seat-passenger`,
  `rear-seat`

Baked animation: one glTF clip named **"Showcase"** (~9s): hood opens →
trunk opens → wipers sweep ×3 → roof + headliner lift away.

Paint material: index 6, `Car_Paint_-_All_Colors`, currently gray
`[0.42, 0.43, 0.45]`, metallic 0.3, roughness 0.45 (baseColorTexture removed).

## Effects inventory (all implemented in the reference viewer)

- **Climate glow** — two stacked planes over the cabin with an elongated radial
  gradient texture (bright at dash, dissolves rearward; no straight edges):
  a NormalBlending "tint" layer + AdditiveBlending "glow" core. Heat
  `0xD92B3A`, A/C `0x4FA0E8`. Slow opacity breathe only — no spatial motion.
- **Wind washes** — the designer's PNGs (`assets/wind/`), rendered STATIC on
  three planes: over each front seat + console-to-rear. Fade in/out with
  climate mode; heat uses Red_wind, A/C uses Cool_wind. Do not animate drift.
- **Seat heat icons** — omnipresent sprites above driver/passenger/rear seats,
  drawn from the SVG's three arrow paths; level 0–3 = N red arrows. Three
  independent controls (matches Figma: Driver / Passenger / Back row).
- **Light beams** — soft dissolving textured cones (canvas radial gradient +
  blurred triangle mask), flat + upright crossed planes per lamp, plus a glow
  sprite at the source. Headlights forward (+Z), taillights red rearward,
  fog lights low/wide/strong (`max 0.8`, warm white, positions in CONFIG).
  Lamp meshes also get emissive: headlight names start with
  `headlight-projector|headlights-drl|headlights-led|headlights-cover`;
  taillights with `taillight` / `TRUNK__taillight`.
- **Camera presets** — threeq (front 3/4, theta 0.8), top and cabin have
  **theta = π so the front of the car points UP on screen**, side (theta π/2).
  Cabin view auto-hides roof + glass, restores on leaving.
- **Capture** — transparent-background PNG snapshot and GIF recording
  (3-2-1 countdown, 12fps, alpha-keyed) — port if in scope.

## Suggested architecture

- Vite + React + react-three-fiber + drei (`useGLTF`). TypeScript welcome.
- Central vehicle-state object as the single source of truth. **Implemented** in
  `src/state/vehicleState.ts` (shape matches Figma, which is richer than the
  original sketch):
  ```ts
  {
    view: 'threeq'|'top'|'side'|'cabin',
    environment: { externalTemp: number, weather: 'clear'|'rain'|'fog' }, // the outside world
    // Interior
    climate: 'off'|'auto'|'ac'|'heat', temperature: number, // °F 60–85 (desired cabin target)
    fan: boolean, recirculation: boolean,
    seatHeat: { driver: 0|1|2|3, passenger: 0|1|2|3, rear: 0|1|2|3 },
    // Exterior
    headlights: 'auto'|'on'|'off', taillights: 'auto'|'on'|'off',
    foglights: boolean, wiper: 'auto'|'on'|'off',
    trunk: boolean, frunk: boolean, // open?
  }
  ```
- **`src/state/autoResolve.ts`** turns every `'auto'` setting into concrete behaviour
  against the `environment` + device clock (the stored state stays `'auto'`; the 3D
  effects read the resolved value): **climate** auto → compares `externalTemp` vs
  `temperature` (warmer outside → `ac`, colder → `heat`, within ±1° → `off`); **wiper**
  auto → `rain?on:off`; **headlights** auto → `fog || night ? on : off` (`isNight()` from
  `new Date()`); **taillights** auto → mirror headlights; **foglights** → manual OR
  `weather==='fog'` (and only cast when headlights are effectively on). Displayed +
  editable via `EnvironmentPanel` (under the app title).
- **Everything mutates state through `src/state/vehicleCommands.ts`** — the named
  command vocabulary (`setClimate('heat')`, `setSeatHeat('rear', 2)`,
  `setCameraView('cabin')`, `openTrunk`≈`setTrunk(true)`, …). The sidebar calls
  these directly; the future LLM tool layer is a thin adapter that exposes each
  command as a tool. **This command list IS the trigger vocabulary** — the agent
  chat ("keep the kids warm") resolves to `setClimate('heat')` + `setSeatHeat('rear', 2)`.
  Read state in React via `useVehicle(selector)`; the viewer reads it per-frame via a ref.
- Animate pivots/opacities toward targets with per-frame damping
  (reference uses `x += (target - x) * (1 - 0.002^dt)`), not tweens.

## Project scaffold (current state)

Built so far: the 3D viewer with the four camera presets, the full Tidal UI shell
(Pass 1), **all of Pass 2**, and the **Pass 3 agent chat**. **Reacting to state:** trunk /
frunk (hood) / wipers, cabin roof+glass dissolve, climate glow (AC/Heat) + wind washes
(Fan), seat-heat 3D sprites, and head/tail/fog light beams + emissive lamps. The Liquid
agent chat panel is built (see `src/agent/` + `src/ui/agent/`) — a **scripted** flow that
fires REAL vehicleCommands. **Still deferred:** wiring a live LLM in place of the scripted
`resolveScript` (the command vocabulary is the ready-made tool surface).

- `index.html` → `src/main.tsx` → `src/App.tsx` (root has `class="dark"`);
  `App.tsx` just renders `<AppShell/>`.
- `src/index.css` — global stylesheet (Tidal tokens + Tailwind layers + fonts).
- `src/state/`
  - `vehicleState.ts` — the store (`getState`/`setState`/`subscribe` + `useVehicle`
    hook via `useSyncExternalStore`) and all types. Single source of truth.
  - `vehicleCommands.ts` — the named command vocabulary (see architecture above);
    the only way state is mutated.
- `src/ui/`
  - `AppShell.tsx` — base layout: viewport (+ overlays) left, `Sidebar` right.
  - `Sidebar.tsx` + `sections/{Interior,Exterior}Section.tsx` — Tidal `SidePanel`
    with the Interior/Exterior controls, each wired to a `vehicleCommands` fn.
  - `controls/` — `SegmentedControl` (custom, matches the Tidal Tabs look — `--muted`
    track, `neutral-700` thumb — but with a **single sliding thumb** that animates between
    options via a measured `translateX`/width transition; not Tidal `Tabs`),
    `TemperatureStepper`, `SeatHeaterControl` + `SeatHeatIcon`, `ControlRow`.
  - `Header` (app title + `EnvironmentPanel`), `CameraViewTabs`, `MusicPlayer`
    (a **mock Spotify player** driven by `src/state/musicStore.ts` — a ticker advances a
    simulated playhead so it feels live; play/pause, prev/next through a fictional
    playlist, working volume, progress line; no real audio), `AgentFab` (opens the chat),
    `icons.tsx` (small inline icon set).
  - `EnvironmentPanel.tsx` — the outside-world display under the title: external
    temperature (chevrons nudge it) + weather (click cycles clear→rain→fog); the
    Clear icon is sun/moon per the device clock. Drives all Auto behaviour via
    `autoResolve`. This is the demo's handle for showing the Auto rules react.
  - `panelStyle.ts` — the shared floating-panel `PANEL_STYLE` (used by `Sidebar`
    and `AgentPanel` so the chat occupies the exact same 500px slot as the config).
  - `agent/` — the **Liquid agent chat** (Pass 3, Figma 123:2751). `AgentPanel.tsx`
    (500px aside: close-button header · scrolling messages · composer; **slides in to the
    RIGHT of the config `Sidebar`, pushing it left** — both panels stay visible — while
    `agentStore.open`; the camera-view tabs dock into the config panel top). `AgentMessages.tsx` (empty
    droplet, right-aligned 300px user bubbles, agent blocks: Thinking…/Calling tools…
    shimmer + fake inference telemetry, collapsible tool-call list, playback bar with
    karaoke word-lighting + a `tokens · time · tok/s` stat). Agent text **streams in
    word-by-word** (ChatGPT/Claude-style: staggered fade+de-blur via the `stream-word`
    CSS class, `backwards` fill so karaoke still works after); messages fade-slide in
    (`msg-enter`). `AgentInput.tsx` (composer
    pill, per Figma: multi-line auto-growing `textarea` (`field-sizing:content`); a white
    mic circle + subtle send arrow when idle; while listening the mic becomes a **violet
    rounded-square** stop and the pill gets the `agent-listening` glow; while busy the
    streamed utterance shows muted with a single white square-stop that `interrupt`s).
    The violet accent is `--agent-accent` (index.css) — this Tidal build ships no
    `--primary`, so it aliases `--chart-2` (#8b5cf6); it drives the glow + square.
- `src/agent/` — the chat's state + script + the **live-LLM integration bridge**.
  - `agentStore.ts` — `useSyncExternalStore` store for the chat: `open`, `input`,
    `listening`, `busy`, `messages`, `playingId`/`playProgress`, plus the **voice-agent
    runtime** (`phase`, `micMuted`, `transcript`, `consoleLog`, `consoleOpen`). Actions:
    `openChat`/`closeChat`, `toggleListening` (simulates speech), `send` (scripted
    thinking→calling→done flow firing REAL `vehicleCommands`), `interrupt`, `togglePlay`
    (simulated TTS karaoke), `toggleTools`; and the externally-driven `setPhase`,
    `setMicMuted`/`toggleMic`, `setTranscript`, `pushConsole`/`clearConsole`/`toggleConsole`,
    `agentUserMessage`, `agentRespond`.
  - `scripts.ts` — `resolveScript(utterance)`: keyword-matches to a canned `AgentScript`
    (the placeholder demo flow; still used by `send`).
  - **`toolbox.ts`** — the machine-readable tool registry (`TOOLS`): each tool has a
    JSON-schema-ish `parameters` spec + an `invoke(args)` that runs the REAL command and
    returns a confirmation string. Covers camera/climate/interior/lights/wipers/access/
    environment/music. `getVehicleSnapshot()` returns the full read-only state (incl.
    resolved `auto` values). **This is the LLM tool surface.**
  - **`agentRuntime.ts`** — `installAgentRuntime()` attaches **`window.LiquidCar`** (the
    JS bridge the real assistant hooks into): `{ version, tools, invoke(name,args),
    getState, subscribe, chat:{open,close,userMessage,respond,setTranscript},
    agent:{setPhase,muteMic,unmuteMic,setMicMuted,log,clearLog} }`. Installed from
    `App.tsx`. **Full docs in `/AGENT_TOOLBOX.md`.**
- `src/ui/agent/` also has: `AgentStatus.tsx` (voice-status modal overlaying the messages,
  animated per `phase` — wake=pulse ring, voice=waveform, processing=dots, speaking=waveform,
  + live transcript), `AgentConsole.tsx` (collapsible timestamped console log; every
  `invoke` is logged). The panel header has mic-mute + console toggles.
- `src/viewer/`
  - `views.ts` — the four camera presets (`VIEWS`) ported from the reference
    `CONFIG.views`, plus `ViewId`, `VIEW_ORDER`, `VIEW_LABELS`.
  - `Viewer.tsx` — `<Canvas>`: transparent (app gradient shows through), hemisphere
    + key + fill lights (matching the reference), `<Suspense>` around the model,
    fov 40 / near 0.05 / far 100; reads the active `view` from the store.
  - `Sedan.tsx` — `useGLTF('/models/sedan_animated_gray.glb')`; calls the effect hooks
    and reports the **bare car's** bounding-box centre so the camera orbits the real
    model. The effect hooks add overlay geometry to the same scene (light beams reach
    ~8m forward), so the centre is measured by a pruning traversal that **skips any
    subtree flagged `userData.isFx`** (beam group, climate glow group, seat sprites) and
    skips sprites — otherwise those would badly skew the orbit centre (esp. in top view).
  - `useCarRig.ts` — drives the mechanical pivots from state each frame (read live
    via `getState`, no re-renders): frunk→`PIVOT_hood` (−40°), trunk→`PIVOT_trunk`
    (+60°) damped `x += (target-x)*(1-0.002^dt)`; wipers→`PIVOT_wiper_L/R` oscillate
    about the windshield normal when `wiper === 'on'`. Ported from the reference.
  - `useCabinReveal.ts` — on `view === 'cabin'`, dissolves the roof
    (`ROOF_panel`, `INTERIOR_headliner`: lift +0.65Y + fade) and glass (`*GLASS*`,
    `*__glass*`: fade) via a damped 0→1 reveal; restores on leaving. Materials are
    cloned before mutating opacity (GLB materials are shared).
  - `useClimateEffects.ts` — **two independent controls** (Delora's spec, richer
    than the reference): **Climate (AC/Heat) drives the cabin GLOW**, **Fan drives
    the WIND washes**. Glow = 2 stacked planes (NormalBlending tint + AdditiveBlending
    core) sharing a canvas texture with **two radial blooms — front (windshield ∩
    dash, brighter) + rear (backlight ∩ interior)** so it emanates from the glass
    seams; `heat`→light orange-red `0xff9a9a`, `ac`→blue `0x4fa0e8`, `auto`/`off`→none;
    slow opacity breathe (`TINT_MAX`/`GLOW_MAX` tuned ~60% for a subtle wash). Wind =
    3 planes (`assets/wind/{Red,Cool}_wind.png`, imported) toward the seats, shown
    when **`fan` is on**; warm (Red_wind) when `climate==='heat'`, cool/white
    (Cool_wind) otherwise. Only shows in cabin view (physically inside the cabin).
  - `useSeatIcons.ts` — a `THREE.Sprite` above each seat (`front-seat`,
    `front-seat-passenger`, `rear-seat`) at y=1.15, canvas-drawn from the shared
    `src/seatArrowPaths.ts` (first N of 3 arrows **coral `#FB7059`**, inert arrows
    gray `#7A7A80` at **50% opacity** via `SEAT_HEAT_OFF_OPACITY`). Depth-tested, so
    the roof/body hide them outside cabin view. Updates texture when `seatHeat[id]`
    changes. (Same colors/opacity in the DOM `SeatHeatIcon`.)
  - `useLights.ts` — light beams + emissive lamps. Per lamp group: soft dissolving
    textured cones (a flat + upright crossed plane pair from a blurred-triangle canvas
    mask, AdditiveBlending) + a glow sprite at the source; head forward `0xcfc6ee`,
    fog low/wide/strong (`max 0.8`, warm `0xf2ecda`), tail rearward red `0xe0342c`.
    Also boosts emissive on the real lamp meshes (`headlight-projector|headlights-drl|
    headlights-led|headlights-cover`; `taillight|TRUNK__taillight`), materials cloned.
    Bound to state: headlights/taillights `=== 'on'` (auto/off dark); **fog only casts
    when `foglights && headlights === 'on'`** (fog needs the headlights on — the Fog UI
    control also greys out otherwise, see `ExteriorSection`). Beam opacity + emissive
    intensity damp `(1-...)` toward target. Group carries `userData.isFx` + a marker name
    (`fx-light-beams`) so stale beams from a hot-reload are cleared on remount and the
    group is excluded from camera centring. Ports reference `makeBeams` / `CONFIG.beams`.
  - `CameraRig.tsx` — spherical camera. **Convention:** `phi` = polar angle from
    `+Y`, `theta` = azimuth in XZ where `theta=0` faces `+Z` (front of car),
    `r` = radius (m). Damps toward the preset (and centre) each frame with
    `x += (target - x) * (1 - 0.0001^dt)`; drag orbits, wheel zooms — same
    tuning as the reference. **`padRight` prop:** the canvas is full-bleed behind the
    floating panel, so the camera applies `setViewOffset` (off-axis shear left by
    `padRight/2`) to keep the car composed in the viewport area left of the panel.

Scripts: `npm run dev` (Vite), `npm run build` (tsc -b + vite build),
`npm run typecheck`.

## Design system (Tidal)

UI is built with **Tidal** — Liquid AI's React design system
(`@liquidai/react` + `@liquidai/tokens`). Setup is done; details:
https://tidal.liquid-internal.com/installation

**Wiring (already in place):**
- `src/index.css` starts with `@import "@liquidai/tokens/css";` (design tokens as
  CSS custom properties), then the three `@tailwind` layers.
- `tailwind.config.ts` uses `presets: [tidalPreset]` from
  `@liquidai/tokens/tailwind`, `darkMode: "class"`, and a `content` glob that
  includes `node_modules/@liquidai/react/dist/**/*.js` so component classes are
  extracted. `postcss.config.js` runs tailwind + autoprefixer.
- Fonts (Inter / Iowan Old Style / JetBrains Mono) are declared via `@font-face`
  in `index.css`. **TODO:** drop the font files into `public/fonts/`
  (`Inter-Variable.woff2`, `JetBrainsMono-Variable.ttf`) to activate them — until
  then system-font fallbacks render (the build warns about the missing files;
  that's expected).

**Usage:** `import { Button, Input, Card, Tabs, ... } from "@liquidai/react";`
(all components from the root, no sub-path imports). 45+ components ship — scan
the exports before hand-rolling UI.

**Icons:** [Tabler](https://tabler.io/icons) via `@tabler/icons-react`, wrapped in
`src/ui/icons.tsx` at **1.5px stroke**; color follows `currentColor` — **muted by
default, foreground when active/selected** (`ControlRow` flips this via its `active`
prop). Brand marks (Spotify, Liquid) and the seat-heat level arrows stay custom SVG.

**Panels & canvas:** the app canvas is
`linear-gradient(180deg, var(--sidebar-background) -21.71%, var(--muted) 100%)` with
the 3D `<Canvas>` rendered transparent over it. Floating panels (config sidebar) sit
20px inset with `border-radius: var(--radius)`, `1px solid var(--sidebar-border)`, a
subtle top→bottom black wash over `--sidebar-background`, and `shadow-overlay`. Note:
Tidal has no `--muted` token — `src/index.css` shims it to `--background-secondary`.

**Config panel spec** (`src/ui/Sidebar.tsx`): **500px** wide; stacked `Band`s
separated by full-width `--sidebar-border` dividers — Interior, Exterior (head/tail/fog),
Windshield wiper (own band), Trunk/Frunk (own band). Each band has **24px** (`p-7`)
inset. Every control is **300px** wide (`ControlRow` right column). Type is **base
(14px) / medium** everywhere; section titles are `text-foreground`, control labels are
`text-muted-foreground` (leading icon brightens to foreground when active). Seat heater
= three tall buttons (icon over label: Driver / Passenger / Backseat). Agent FAB uses
`public/brand/liquid-logomark-white.png`.

**Canvas overlays** (`AppShell.tsx`): the 3D `<Viewer>` canvas is **full-bleed**
(`absolute inset-0`, `overflow-hidden` root) so the car slides *behind* the floating
panel instead of being clipped at its edge; the panel floats on top (`absolute right-0
p-5`). The overlays — title left, camera-view switcher right, music player bottom-center,
agent FAB bottom-right — live in a `pointer-events-none` layer confined to the viewport
area left of the panel (`right: PANEL_FOOTPRINT` = 540px), with interactive children
re-enabled (`pointer-events-auto`) so canvas drag/zoom passes through the gaps. A top
scrim (`linear-gradient(180deg, var(--sidebar-background) 0%, transparent 100%)`, 140px,
`pointer-events-none`, behind the overlays) keeps the title/camera legible when bright
content (cabin view) reaches the top edge.

**Essential rules (full guide before building UI):**
- **Read the bundled agent guide** `node_modules/@liquidai/react/CLAUDE.md` and,
  for the complete design system (principles, token taxonomy, every component's
  API, UX patterns), fetch
  `https://tidal-design-system-docs.vercel.app/llms-full.txt`.
- **No raw hex colors.** Use semantic tokens (`text-foreground`, `bg-secondary`,
  `text-status-error`) or CSS vars (`var(--primary)`).
- **No `dark:` prefixes** — tokens adapt via CSS custom properties.
- **Status colors:** `text-status-error` (red) / `-warning` (amber) / `-success`
  (green) / `-info` (cerulean). Never green for warnings.
- **Hierarchy:** every screen has exactly one Level 1. Headings: h1 `text-2xl`,
  h2 `text-lg`, h3/h4 `text-base font-medium`.
- `Tabs` for view switching (e.g. the camera-view tabs), `PageTabBar` for
  document tabs.
- Propose a build plan (layout pattern, key components, all states) before
  building new pages/major features.

## Working style

- Port one behavior at a time; verify each against
  `reference/sedan_demo_viewer.html` open in a second tab and against
  `reference/comps/`. The designer (Delora) is the visual acceptance judge.
- Never rename the GLB's nodes; all behavior binds by these names.
- Materials are shared across meshes in the GLB — clone before mutating
  (emissive, opacity) or unrelated parts will change too.
