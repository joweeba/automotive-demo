# Automotive Assistant Demo

Web UI demo: an on-device AI assistant controlling a 3D vehicle.
Designs: see Figma link in CLAUDE.md. Rig spec, effects inventory, and
architecture guidance: **CLAUDE.md** (read it first — Claude Code does automatically).

## Quick start
1. `git init && git add -A && git commit -m "starter kit"`
2. Open in Claude Code and ask it to scaffold the app per CLAUDE.md
   (Vite + React + react-three-fiber), porting behaviors from
   `reference/sedan_demo_viewer.html` one at a time.
3. To eyeball the reference implementation: open
   `reference/sedan_demo_viewer.html` in a browser and drop
   `public/models/sedan_animated_gray.glb` onto it.

## What's here
- `public/models/` — rigged, animated, gray-painted sedan GLB
- `reference/` — working single-file viewer (acceptance reference), rig
  data (`rig/sedan_hinges.json`), and design boards (`comps/`)
- `assets/` — wind wash PNGs and the seat-heat icon SVG
