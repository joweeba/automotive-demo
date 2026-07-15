import { TOOLS, getVehicleSnapshot } from "./toolbox";
import { subscribe } from "../state/vehicleState";
import { subscribeMusic } from "../state/musicStore";
import {
  openChat,
  closeChat,
  agentUserMessage,
  agentRespond,
  setPhase,
  setMicMuted,
  setTranscript,
  pushConsole,
  clearConsole,
  getAgentState,
  subscribeAgent,
} from "./agentStore";
import type { AgentPhase, AgentResponse, LogLevel } from "./agentStore";
import {
  ingest as bmwIngest,
  connect as bmwConnect,
  disconnect as bmwDisconnect,
  reset as bmwReset,
  getMirror as bmwGetMirror,
  PROTOCOL_VERSION as BMW_PROTOCOL_VERSION,
} from "./bmwRenderer";

// ---------------------------------------------------------------------------
// The public JS bridge the LLM assistant hooks into: window.LiquidCar.
//
// One object with (a) the tool manifest + invoke(), (b) a read-only state
// snapshot + subscribe, and (c) helpers to drive the chat panel and the voice
// status UI. Everything the assistant does routes through here. Fully documented
// in /AGENT_TOOLBOX.md.
// ---------------------------------------------------------------------------

const VERSION = "1.1.0";

export interface LiquidCarAPI {
  version: string;
  /** Tool manifest (name/description/parameters) — map onto function-calling tools. */
  tools: { name: string; description: string; parameters: unknown }[];
  /** Run a tool by name. Returns a human-readable confirmation; throws on bad input. */
  invoke: (name: string, args?: Record<string, unknown>) => string;
  /** Read-only snapshot of the vehicle + environment + music (includes resolved 'auto' values). */
  getState: () => ReturnType<typeof getVehicleSnapshot>;
  /** Subscribe to any vehicle/music/agent change. Returns an unsubscribe fn. */
  subscribe: (cb: () => void) => () => void;

  /** Drive the chat transcript. */
  chat: {
    open: () => void;
    close: () => void;
    /** Post the user's utterance as a bubble. */
    userMessage: (text: string) => number;
    /** Post a completed assistant response (the model owns the wording + tool summary). */
    respond: (response: AgentResponse) => number;
    /** Live speech transcript shown under the status modal while listening. */
    setTranscript: (text: string) => void;
  };

  /** Drive the voice-status UI + console. */
  agent: {
    /** 'idle' | 'wake' | 'voice' | 'processing' | 'speaking' — animates a status modal. */
    setPhase: (phase: AgentPhase) => void;
    muteMic: () => void;
    unmuteMic: () => void;
    setMicMuted: (muted: boolean) => void;
    /** Append a line to the in-panel console log. */
    log: (text: string, level?: LogLevel) => void;
    clearLog: () => void;
  };

  /**
   * Renderer/consumer of the `bmw_emulator` NDJSON event stream (spec §4.5).
   * The emulator grounds the model's commands and PUSHES state changes here; this
   * reflects them in the 3D car. See ./bmwRenderer + AGENT_TOOLBOX.md.
   */
  render: {
    /** NDJSON protocol version this consumer speaks (refuses others). */
    protocolVersion: number;
    /** Feed a raw NDJSON line / multi-line chunk, or a parsed event object. */
    ingest: (data: string | object) => void;
    /** Connect to an emulator NDJSON WebSocket bridge (auto-reconnects). */
    connect: (url: string) => void;
    /** Stop consuming and cancel reconnect. */
    disconnect: () => void;
    /** Clear the mirrored state (before reconnecting to a fresh emulator). */
    reset: () => void;
    /** Read-only copy of the mirrored flattened emulator state. */
    getState: () => Record<string, string>;
    /** Convenience typed entrypoints (wrap ingest with the v1 envelope). */
    snapshot: (state: Record<string, string>) => void;
    stateChange: (changes: { path: string; from?: string; to: string }[], summary?: string) => void;
    animation: (evt: { target: string; action: string; detail?: string }) => void;
    activation: (evt: { kind: string; detail?: string }) => void;
  };
}

let installed: LiquidCarAPI | null = null;

export function installAgentRuntime(): LiquidCarAPI | null {
  if (typeof window === "undefined") return null;
  if (installed) return installed;

  const api: LiquidCarAPI = {
    version: VERSION,
    tools: TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters })),

    invoke(name, args = {}) {
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        pushConsole("error", `unknown tool: ${name}`);
        throw new Error(`LiquidCar: unknown tool "${name}"`);
      }
      try {
        const result = tool.invoke(args);
        pushConsole("tool", `${name}(${JSON.stringify(args)}) → ${result}`);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushConsole("error", `${name}: ${msg}`);
        throw err;
      }
    },

    getState: getVehicleSnapshot,

    subscribe(cb) {
      const unsubs = [subscribe(cb), subscribeMusic(cb), subscribeAgent(cb)];
      return () => unsubs.forEach((u) => u());
    },

    chat: {
      open: openChat,
      close: closeChat,
      userMessage: agentUserMessage,
      respond: agentRespond,
      setTranscript,
    },

    agent: {
      setPhase,
      muteMic: () => setMicMuted(true),
      unmuteMic: () => setMicMuted(false),
      setMicMuted,
      log: (text, level = "info") => pushConsole(level, text),
      clearLog: clearConsole,
    },

    render: {
      protocolVersion: BMW_PROTOCOL_VERSION,
      ingest: bmwIngest,
      connect: bmwConnect,
      disconnect: bmwDisconnect,
      reset: bmwReset,
      getState: bmwGetMirror,
      snapshot: (state) => bmwIngest({ v: BMW_PROTOCOL_VERSION, event: "snapshot", state }),
      stateChange: (changes, state_summary) =>
        bmwIngest({ v: BMW_PROTOCOL_VERSION, event: "state_change", changes, state_summary }),
      animation: (evt) => bmwIngest({ v: BMW_PROTOCOL_VERSION, event: "animation", ...evt }),
      activation: (evt) => bmwIngest({ v: BMW_PROTOCOL_VERSION, event: "activation", ...evt }),
    },
  };

  (window as unknown as { LiquidCar: LiquidCarAPI }).LiquidCar = api;
  installed = api;
  pushConsole("event", `LiquidCar runtime v${VERSION} ready · ${TOOLS.length} tools · bmw renderer v${BMW_PROTOCOL_VERSION}`);
  // Auto-connect to an emulator bridge if the page was opened with ?emulator=ws://…
  try {
    const url = new URLSearchParams(window.location.search).get("emulator");
    if (url) bmwConnect(url);
  } catch {
    /* location unavailable — ignore */
  }
  // Surface the current state getter for quick manual poking in devtools.
  void getAgentState;
  return api;
}
