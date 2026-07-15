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

// ---------------------------------------------------------------------------
// The public JS bridge the LLM assistant hooks into: window.LiquidCar.
//
// One object with (a) the tool manifest + invoke(), (b) a read-only state
// snapshot + subscribe, and (c) helpers to drive the chat panel and the voice
// status UI. Everything the assistant does routes through here. Fully documented
// in /AGENT_TOOLBOX.md.
// ---------------------------------------------------------------------------

const VERSION = "1.0.0";

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
  };

  (window as unknown as { LiquidCar: LiquidCarAPI }).LiquidCar = api;
  installed = api;
  pushConsole("event", `LiquidCar runtime v${VERSION} ready · ${TOOLS.length} tools`);
  // Surface the current state getter for quick manual poking in devtools.
  void getAgentState;
  return api;
}
