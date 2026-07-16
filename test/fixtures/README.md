# Golden NDJSON corpus — EXHAUSTIVE cross-repo UI integration regression

The `variants/` corpus is **generated, not hand-authored**. It is a deterministic
capture of the Liquid4All/assistant emulator's NDJSON renderer stream (protocol
v2) for EVERY `(intent, valid_slot_combination)` variant of the shipped `bmw_new`
vocabulary — no model, no microphone.

A "variant" is one `(intent, slot_combination)` pair — the exact sharding the
model team's eval/datagen uses (`Liquid4All/intents`
`bmw_new/slot_modeling/valid_slot_combinations.py`). All 58 intents × their
`valid_slot_combinations` (475 combos) are enumerated, PLUS extra variants so
that every enum value of every intent slot is exercised at least once. It is
derived from the source of truth `proto::intent_collection::bmw_new`, so it can
never drift from the vocabulary.

## Layout (`variants/`)

- `_boot.ndjson` — the shared `snapshot` + boot `reconcile` `state_change`,
  identical for every variant (same `bmw_3series` profile). The test prepends it
  before each variant so every replay starts from the real boot state.
- `<intent>.ndjson` — one JSON object per line, one per variant:
  `{ "variant", "intent", "base", "combo", "signature", "events": [ …the turn's
  state_change / animation / outcome… ] }`.
- `manifest.json` — variant→file index + counts.

## The regression it drives

`test/variants.integration.test.ts` replays each variant (reset renderer →
ingest `_boot` → ingest the variant's `events`) and asserts:

- (a) ZERO error-level console output (a genuine `rejected` outcome may be error;
  `not_equipped` / `not_implemented` must NOT be).
- (b) every emitted path the renderer MAPS is reflected in `getState()` /
  `getMusic()` (no silent drop).
- (c) every emitted state path is EITHER mapped OR on the explicit
  `KNOWN_UNRENDERED` ignore-list (each with a one-line reason). A path that is
  neither → the test FAILS. This is what makes it exhaustive: a new or dropped
  subsystem can't pass silently.

## Regenerate

From a checkout of Liquid4All/assistant (sibling to this repo):

```sh
tools/ui/gen_golden_ndjson.sh /path/to/automotive-demo/test/fixtures
```

Re-run and commit the regenerated corpus whenever the emulator's flatten/NDJSON
emit or the `bmw_3series` vehicle profile changes. The generator
(`emulator/tests/ui_corpus.rs`) is the single source of truth; do not edit these
files by hand.
