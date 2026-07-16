# Golden NDJSON fixtures — cross-repo UI integration regression

These `*.ndjson` files are **generated, not hand-authored**. Each is a
deterministic capture of the Liquid4All/assistant emulator's NDJSON renderer
stream (protocol v2: `snapshot` → reconcile `state_change` → per-turn
`state_change` / `animation` / `outcome`) for one typed `bmw_new` signature —
no model, no microphone.

They are the contract between OUR emulator's `VehicleState::flatten()` NDJSON
emit and HER `src/agent/bmwRenderer.ts` mapping. The vitest regression
`test/bmwRenderer.integration.test.ts` replays each and asserts the UI reflects
the command with zero error-level console output.

## Regenerate

From a checkout of Liquid4All/assistant (sibling to this repo):

```sh
tools/ui/gen_golden_ndjson.sh /path/to/automotive-demo/test/fixtures
```

Re-run and commit the regenerated fixtures whenever the emulator's flatten/NDJSON
emit or the `bmw_3series` vehicle profile changes. The generator is the single
source of truth; do not edit these files by hand.

## Coverage

climate (temp/fan/AC/auto/seat-heat), media (mute/volume/source/track), lighting,
windows, drive mode, nav, ambient, plus the capability-gated `not_equipped`
(blinds on the 330i base trim) and `not_implemented` (snapshot) outcomes.
