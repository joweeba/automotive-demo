// ---------------------------------------------------------------------------
// LIVE cross-process end-to-end integration: real emulator process + real
// WebSocket + HER real bmwRenderer.
//
// The in-process golden regression (test/variants.integration.test.ts) replays
// pre-captured NDJSON fixtures straight into ingest() — it proves the
// grounding→renderer MAPPING but NOT the live transport. THIS harness spawns the
// actual `emulator --features ui --ui` binary, opens a real WebSocket to its bridge,
// and:
//
//   Phase A — drives every (intent, valid_slot_combination) variant through the LIVE
//     process using the model-free `signature` inbound control (deterministic; no
//     model, no mic), feeding each received NDJSON line into HER bmwRenderer.ingest()
//     and asserting the SAME contract (./uiContract) per turn off the live stream.
//   Phase B — inbound-audio round-trip: streams PCM16 decoded from a recorded WAV as
//     binary WS frames (continuous mic_start, then a ptt_down/ptt_up cycle) and asserts
//     a turn grounds + HER renderer reflects it, plus the PTT turn's
//     follow_up_window=none (the #183 single-shot fix), read off the emulator's
//     --verbose [emu-conv] trace.
//   Phase C — HER real bidirectional transport: reconnect via bmwRenderer.connect() and
//     drive one PTT cycle via her sendControl()/sendAudio(), proving her outbound code +
//     snapshot-on-connect live.
//
// Requires the built binary via EMULATOR_BIN; skipped (not failed) without it, so it is
// never part of the default `npm test`. Run: `npm run test:e2e`.
// ---------------------------------------------------------------------------
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ingest,
  reset,
  getMirror,
  connect,
  disconnect,
  sendControl,
  sendAudio,
  buildControlMessage,
  AUDIO_FORMAT,
} from "../../src/agent/bmwRenderer";
import { clearConsole, getAgentState } from "../../src/agent/agentStore";
import { assertContract } from "../uiContract";

const EMULATOR_BIN = process.env.EMULATOR_BIN ?? "";
const HAVE_BIN = EMULATOR_BIN.length > 0 && existsSync(EMULATOR_BIN);
const FIX = resolve(__dirname, "..", "fixtures", "variants");
const WAV = resolve(__dirname, "..", "fixtures", "smoke.wav");

// ── fixtures: the SAME enumeration the golden corpus uses (one variant per
//    (intent, valid_slot_combination), derived from proto::intent_collection::bmw_new).
interface VariantRecord {
  variant: string;
  intent: string;
  base: boolean;
  combo: string[];
  signature: string;
  events: { event: string; changes?: { path: string; to: string }[]; result?: string }[];
}
function loadVariants(): VariantRecord[] {
  if (!existsSync(FIX)) return [];
  const out: VariantRecord[] = [];
  for (const f of readdirSync(FIX).sort()) {
    if (!f.endsWith(".ndjson") || f === "_boot.ndjson") continue;
    for (const line of readFileSync(resolve(FIX, f), "utf8").split(/\r?\n/)) {
      if (line.trim()) out.push(JSON.parse(line) as VariantRecord);
    }
  }
  return out;
}

/** Decode a 16 kHz mono PCM16 WAV to Int16 samples (LE), scanning RIFF chunks for `data`. */
function readWavPcm16(path: string): Int16Array {
  const buf = readFileSync(path);
  let off = 12; // skip "RIFF"<size>"WAVE"
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "data") {
      const end = Math.min(body + size, buf.length);
      const n = Math.floor((end - body) / 2);
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(body + i * 2);
      return out;
    }
    off = body + size + (size & 1); // chunks are word-aligned
  }
  throw new Error(`no data chunk in ${path}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── a live WebSocket client: feeds every received line into HER ingest(), parses
//    events for per-turn segmentation, and drives the emulator over the SAME socket.
class LiveClient {
  private ws: WebSocket;
  events: Record<string, unknown>[] = [];
  snapshots = 0;
  private listeners: ((ev: Record<string, unknown>) => void)[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (e) => {
      const data = typeof e.data === "string" ? e.data : "";
      if (!data) return;
      ingest(data); // HER renderer consumes the raw NDJSON line(s)
      for (const line of data.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t[0] !== "{") continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(t);
        } catch {
          continue;
        }
        if (ev.event === "snapshot") this.snapshots++;
        this.events.push(ev);
        for (const l of [...this.listeners]) l(ev);
      }
    };
  }

  waitOpen(timeoutMs = 10_000): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error("WS open timeout")), timeoutMs);
      this.ws.onopen = () => {
        clearTimeout(to);
        res();
      };
      this.ws.onerror = () => {
        clearTimeout(to);
        rej(new Error("WS error before open"));
      };
    });
  }

  waitForEvent(
    pred: (ev: Record<string, unknown>) => boolean,
    timeoutMs = 8_000,
  ): Promise<Record<string, unknown>> {
    return new Promise((res, rej) => {
      const to = setTimeout(() => {
        remove();
        rej(new Error("timeout waiting for a matching NDJSON event"));
      }, timeoutMs);
      const l = (ev: Record<string, unknown>) => {
        if (pred(ev)) {
          clearTimeout(to);
          remove();
          res(ev);
        }
      };
      const remove = () => {
        this.listeners = this.listeners.filter((x) => x !== l);
      };
      this.listeners.push(l);
    });
  }

  sendJson(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }
  sendPcm(chunk: Int16Array): void {
    this.ws.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
  }
  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }

  /** Drive one typed signature and return the events emitted up to (and incl.) its outcome. */
  async driveSignature(sig: string): Promise<Record<string, unknown>[]> {
    const start = this.events.length;
    this.sendJson({ v: 2, in: "signature", sig });
    await this.waitForEvent((ev) => ev.event === "outcome");
    return this.events.slice(start);
  }
}

// ── the child emulator process ───────────────────────────────────────────────
let child: ChildProcess | null = null;
let stderrLog = "";

function spawnEmulator(): Promise<string> {
  return new Promise((res, rej) => {
    const c = spawn(
      EMULATOR_BIN,
      ["--ui", "--ui-port", "0", "--renderer", "ndjson", "--verbose"],
      // stdout → /dev/null: the emulator TEES the NDJSON stream to stdout as well as the WS
      // bridge. A parent that pipes stdout but never drains it fills the ~64KB OS pipe
      // buffer after a few hundred turns; the emulator's blocking stdout write then wedges
      // its single-threaded turn loop (deadlock). We consume the LIVE stream over the WS, so
      // discard stdout. stderr stays piped (bridge URL + the --verbose [emu-conv] trace).
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    child = c;
    const to = setTimeout(
      () => rej(new Error(`emulator did not announce a bridge URL in time.\nstderr:\n${stderrLog}`)),
      30_000,
    );
    c.stderr!.on("data", (d: Buffer) => {
      stderrLog += d.toString();
      const m = stderrLog.match(/ws:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(to);
        res(m[0]);
      }
    });
    c.on("exit", (code) => {
      clearTimeout(to);
      if (!stderrLog.match(/ws:\/\/127\.0\.0\.1:\d+/))
        rej(new Error(`emulator exited early (code ${code}).\nstderr:\n${stderrLog}`));
    });
  });
}

/** Paths a turn's events changed (union over its state_change events). */
function turnPaths(events: Record<string, unknown>[]): Set<string> {
  const paths = new Set<string>();
  for (const e of events) {
    if (e.event === "state_change" && Array.isArray(e.changes))
      for (const c of e.changes as { path: string }[]) paths.add(c.path);
  }
  return paths;
}

const d = HAVE_BIN ? describe : describe.skip;
let url = "";
let client: LiveClient;

d("LIVE emulator↔UI end-to-end", () => {
  beforeAll(async () => {
    url = await spawnEmulator();
    reset();
    clearConsole();
    client = new LiveClient(url);
    await client.waitOpen();
    // Late-join correctness (assistant fix): a connecting client receives the stale cached
    // construction-time snapshot AND then a fresh CURRENT-state snapshot (boot reconcile
    // folded in). Wait until BOTH have arrived.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (client.snapshots >= 2) break;
      await sleep(25);
    }
  }, 60_000);

  afterAll(() => {
    client?.close();
    disconnect();
    if (child && !child.killed) child.kill("SIGKILL");
  });

  it("late client receives a fresh current-state snapshot, not the stale boot default", () => {
    // The fix: on connect the bridge replays the stale cached construction-time snapshot,
    // then re-emits a CURRENT-state snapshot (boot reconcile folded in). Assert BOTH
    // arrived and the fresh one carries post-boot state the stale one lacked — and that
    // HER mirror ends up reflecting the fresh (current) snapshot.
    const snaps = client.events.filter((e) => e.event === "snapshot") as {
      state: Record<string, string>;
    }[];
    expect(snaps.length).toBeGreaterThanOrEqual(2);
    const first = snaps[0].state;
    const last = snaps[snaps.length - 1].state;
    // The boot reconcile is a non-empty delta, so the fresh snapshot MUST differ from the
    // stale construction-time default (before the fix the client saw only `first`).
    expect(JSON.stringify(last)).not.toBe(JSON.stringify(first));
    // HER mirror reflects the fresh current snapshot (no turns driven yet).
    expect(getMirror()).toEqual(last);
  });

  it("drives every (intent, slot-combo) variant through the LIVE process + WebSocket", async () => {
    const variants = loadVariants();
    expect(variants.length).toBeGreaterThanOrEqual(475);
    expect(new Set(variants.map((v) => v.intent)).size).toBe(58);

    let driven = 0;
    const intentsSeen = new Set<string>();
    for (const v of variants) {
      clearConsole(); // (a) errorLines must reflect only THIS turn
      const events = await client.driveSignature(v.signature);
      const outcome = events.find((e) => e.event === "outcome") as
        | { result?: string }
        | undefined;
      expect(outcome, `variant ${v.variant} emitted no outcome`).toBeTruthy();
      const rejected = outcome?.result === "rejected";
      // Assert the SAME (a)+(b)+(c) contract the golden regression uses, off the LIVE
      // stream: zero error output, every mapped path reflected in HER state, every emitted
      // path mapped-or-ignore-listed. Per-turn delta (not absolute state).
      assertContract(getMirror(), turnPaths(events), { rejected });
      driven++;
      intentsSeen.add(v.intent);
    }
    // Honest live-coverage report.
    // eslint-disable-next-line no-console
    console.log(
      `LIVE intent coverage: drove ${driven}/${variants.length} variants across ` +
        `${intentsSeen.size}/58 intents through the real process + WebSocket`,
    );
    expect(driven).toBe(variants.length); // ALL variants driven live
    expect(intentsSeen.size).toBe(58);
  });

  it("inbound audio round-trip: continuous mic + PTT (follow_up_window=none)", async () => {
    const samples = readWavPcm16(WAV);
    const CHUNK = 1600; // 100 ms @ 16 kHz, as a browser MediaRecorder would emit

    // ── continuous capture: mic_start → PCM frames → trailing silence endpoints it.
    clearConsole();
    const contStart = client.events.length;
    client.sendJson(buildControlMessage("mic_start"));
    for (let i = 0; i < samples.length; i += CHUNK) client.sendPcm(samples.subarray(i, i + CHUNK));
    client.sendPcm(new Int16Array(16_000)); // 1 s silence → endpoint
    const contOutcome = await client.waitForEvent((ev) => ev.event === "outcome", 15_000);
    client.sendJson(buildControlMessage("mic_stop"));
    expect(contOutcome.result).toBe("applied");
    // HER renderer reflected the resulting state_change (a genuine turn grounded).
    const contEvents = client.events.slice(contStart);
    expect([...turnPaths(contEvents)].length).toBeGreaterThan(0);
    assertContract(getMirror(), turnPaths(contEvents), { rejected: false });

    // ── push-to-talk: ptt_down (bypass wake word) → frames → ptt_up (force endpoint).
    const convMark = stderrLog.length;
    clearConsole();
    const pttStart = client.events.length;
    client.sendJson(buildControlMessage("ptt_down"));
    for (let i = 0; i < samples.length; i += CHUNK) client.sendPcm(samples.subarray(i, i + CHUNK));
    client.sendJson(buildControlMessage("ptt_up"));
    const pttOutcome = await client.waitForEvent((ev) => ev.event === "outcome", 15_000);
    expect(pttOutcome.result).toBe("applied");
    const pttEvents = client.events.slice(pttStart);
    expect([...turnPaths(pttEvents)].length).toBeGreaterThan(0);
    assertContract(getMirror(), turnPaths(pttEvents), { rejected: false });

    // #183: a PTT turn is single-shot — it must report follow_up_window=none /
    // wake_word=required, never an open hands-free window. Read off the --verbose trace.
    await sleep(100); // let the [emu-conv] stderr line flush
    const convLines = stderrLog
      .slice(convMark)
      .split("\n")
      .filter((l) => l.includes("[emu-conv]"));
    expect(convLines.length).toBeGreaterThan(0);
    expect(
      convLines.some((l) => l.includes("follow_up_window=none") && l.includes("wake_word=required")),
      `PTT turn must report follow_up_window=none; got: ${convLines.join(" | ")}`,
    ).toBe(true);
    expect(
      convLines.some((l) => /follow_up_window=(expects_answer|continues|reprompt)/.test(l)),
      "a PTT turn must never advertise an open follow-up window",
    ).toBe(false);
  });

  it("HER real transport: reconnect + snapshot-on-connect + sendControl/sendAudio (PTT)", async () => {
    // Close the harness socket and drive a SECOND live connection through HER real
    // bidirectional transport (connect + sendControl + sendAudio) — proving her outbound
    // code AND reconnect + snapshot-on-connect against the same running emulator.
    client.close();
    await sleep(150);
    reset();
    clearConsole();
    connect(url); // HER WebSocket; onmessage → HER ingest
    // Wait until HER mirror re-initializes from the snapshot replayed on connect (proving
    // snapshot-on-connect + HER real receive transport live). State reflects the CURRENT
    // (Phase-A/B-mutated) car, so assert the mirror repopulated rather than a fixed value.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (Object.keys(getMirror()).length > 20) break;
      await sleep(25);
    }
    expect(Object.keys(getMirror()).length).toBeGreaterThan(20);

    // A PTT utterance via HER outbound helpers; observe the grounded turn via HER console.
    const samples = readWavPcm16(WAV);
    const outcomesBefore = getAgentState().consoleLog.filter((e) =>
      e.text.includes("outcome:"),
    ).length;
    sendControl("ptt_down");
    for (let i = 0; i < samples.length; i += 1600) {
      const c = samples.subarray(i, i + 1600);
      sendAudio(new Int16Array(c)); // copy so byteOffset is 0 (her sendAudio slices by offset)
    }
    sendControl("ptt_up");
    const deadline2 = Date.now() + 15_000;
    let grounded = false;
    while (Date.now() < deadline2) {
      const now = getAgentState().consoleLog.filter((e) => e.text.includes("outcome:")).length;
      if (now > outcomesBefore) {
        grounded = true;
        break;
      }
      await sleep(50);
    }
    expect(grounded, "a PTT turn over HER transport must ground and surface an outcome").toBe(true);
    // No error-level console output for the grounded turn.
    expect(getAgentState().consoleLog.filter((e) => e.level === "error").map((e) => e.text)).toEqual(
      [],
    );
  });
});
