#!/usr/bin/env python3
# gen_mercedes_golden.py — regenerate the Mercedes (MBIS) cross-repo UI regression corpus.
#
# The Mercedes counterpart to the assistant repo's tools/ui/gen_golden_ndjson.sh (which
# derives the BMW corpus from proto::intent_collection::bmw_new). Here the source of
# truth is Farris's Mercedes EVAL GOLD dataset: the exact MBIS composite-key signatures
# the lili3-mercedes model is expected to emit (dict keyed by speaker → conversations of
# [user audio, assistant content = MBIS signature, metadata.query_text], with EN/ES/FR/PT
# locale variants). We take the UNION of every unique assistant `content` signature and
# ground each one through the REAL Mercedes emulator cabin (mercedes brand profile + EQS
# vehicle profile) with the NDJSON renderer, capturing its turn events.
#
# Output layout (under OUT_DIR/mercedes/variants/), mirroring the BMW corpus:
#   _boot.ndjson        — the shared snapshot + boot reconcile (identical per run)
#   <domain>.ndjson     — one JSON record per line: {signature,intent,domain,events}
#   manifest.json       — variant→file index + counts + outcome-class histogram
#
# The committed fixtures are what test/mercedes.integration.test.ts consumes — the test
# does NOT need the emulator or the eval data at run time (they are vendored, like BMW).
#
# GENERIC `feature.*` CHANNEL (pending emulator branch). The UI renders a generic
# `feature.<name> = on|off|<value>` channel for the long-tail cabin features the typed
# schema doesn't model (see src/state/featureStore.ts + docs/emulator/mbis-command-taxonomy.md).
# The emulator on `main` does NOT emit `feature.*` yet — most valid MBIS intents still
# ground to `not_implemented` (see the outcome histogram in manifest.json). Once the
# emulator agent's branch (every valid MBIS intent → a vehicle-state change, incl. the
# feature.* channel) lands, RE-RUN this generator against that emulator and the corpus will
# carry real feature.* paths. Until then the feature.* channel is covered by SYNTHETIC,
# hand-authored fixtures in test/feature.integration.test.ts (documented there).
#
# Usage:
#   python3 tools/gen_mercedes_golden.py [OUT_DIR]
# Env overrides:
#   ASSISTANT_REPO  path to the assistant monorepo   (default ../assistant)
#   MB_EVAL_GLOB    glob for the eval JSON files      (default the job tmp dir below)
#   EMULATOR_BIN    prebuilt emulator binary          (default $ASSISTANT_REPO/target/debug/emulator)
import json, os, glob, subprocess, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
ASSISTANT_REPO = os.environ.get("ASSISTANT_REPO", os.path.join(REPO, "..", "assistant"))
ASSISTANT_REPO = os.path.abspath(ASSISTANT_REPO)
EMULATOR_BIN = os.environ.get("EMULATOR_BIN", os.path.join(ASSISTANT_REPO, "target", "debug", "emulator"))
MB_EVAL_GLOB = os.environ.get(
    "MB_EVAL_GLOB",
    "/Users/jcarollo/.claude/jobs/6f3edcaa/tmp/mb-eval/*/liquid_car_function_call_input.json",
)
BRAND_PROFILE = os.path.join(ASSISTANT_REPO, "brand_profiles", "mercedes", "profile.kv")
VEHICLE_PROFILE = os.path.join(ASSISTANT_REPO, "emulator_profiles", "mercedes_eqs", "vehicle.kv")

OUT_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "test", "fixtures")
OUT = os.path.join(OUT_DIR, "mercedes", "variants")


def collect_signatures():
    sigs = []
    files = sorted(glob.glob(MB_EVAL_GLOB))
    if not files:
        sys.exit(f"no eval files matched {MB_EVAL_GLOB}")
    for f in files:
        d = json.load(open(f))
        for _speaker, convs in d.items():
            for conv in convs:
                for turn in conv:
                    if isinstance(turn, dict) and turn.get("role") == "assistant":
                        c = turn.get("content")
                        if c:
                            sigs.append(c)
    # A few well-formed protocol-coverage signatures appended to the eval union so the
    # grounded corpus exercises the cloud-deferral class too (the eval gold's own
    # onlineIntent sigs are malformed — missing the `$` slot marker — so they reject).
    sigs += [
        "generic.onlineIntent|$onlineCategory=weather",
        "generic.onlineIntent|$onlineCategory=news",
        "generic.onlineIntent|$onlineCategory=knowledge",
    ]
    # stable de-dup
    return list(dict.fromkeys(sigs)), files


def ground(sig):
    """Run ONE signature through the emulator; return its NDJSON event lines.
    Line 0 = snapshot, line 1 = boot reconcile, lines[2:] = this turn's events."""
    p = subprocess.run(
        [EMULATOR_BIN, BRAND_PROFILE, "--vehicle-profile", VEHICLE_PROFILE, "--renderer", "ndjson"],
        input=(sig + "\n").encode(),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        cwd=ASSISTANT_REPO,
        timeout=60,
    )
    return [l for l in p.stdout.decode().splitlines() if l.startswith("{")]


def domain_of(sig):
    key = sig.split("|", 1)[0]
    return key.split(".", 1)[0] or "misc"


def main():
    if not os.path.exists(EMULATOR_BIN):
        sys.exit(f"emulator binary not found at {EMULATOR_BIN}\n"
                 f"build it: (cd {ASSISTANT_REPO} && cargo build -q -p emulator)")
    sigs, files = collect_signatures()
    os.makedirs(OUT, exist_ok=True)
    print(f"eval files: {len(files)}; unique signatures: {len(sigs)}", file=sys.stderr)

    boot = None
    shards = collections.defaultdict(list)
    outcomes = collections.Counter()
    n = 0
    for sig in sigs:
        lines = ground(sig)
        if len(lines) < 2:
            print(f"  WARN: {sig!r} produced {len(lines)} lines; skipped", file=sys.stderr)
            continue
        if boot is None:
            boot = lines[:2]
        events = [json.loads(l) for l in lines[2:]]
        for e in events:
            if e.get("event") == "outcome":
                outcomes[e.get("result", "?")] += 1
        rec = {"signature": sig, "intent": sig.split("|", 1)[0], "domain": domain_of(sig), "events": events}
        shards[domain_of(sig)].append(rec)
        n += 1
        if n % 40 == 0:
            print(f"  grounded {n}/{len(sigs)} …", file=sys.stderr)

    if boot is None:
        sys.exit("no boot lines captured")
    with open(os.path.join(OUT, "_boot.ndjson"), "w") as fh:
        fh.write("\n".join(boot) + "\n")
    manifest = {"count": n, "domains": {}, "outcomes": dict(outcomes)}
    for dom, recs in sorted(shards.items()):
        with open(os.path.join(OUT, f"{dom}.ndjson"), "w") as fh:
            for r in recs:
                fh.write(json.dumps(r) + "\n")
        manifest["domains"][dom] = len(recs)
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"done: {n} variants → {OUT}", file=sys.stderr)
    print(f"  domains: {manifest['domains']}", file=sys.stderr)
    print(f"  outcomes: {manifest['outcomes']}", file=sys.stderr)


if __name__ == "__main__":
    main()
