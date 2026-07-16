import { useSyncExternalStore } from "react";
import { resolveScript } from "./scripts";

// ---------------------------------------------------------------------------
// agentStore — UI state + scripted engine for the "Liquid agent" chat panel.
// Same lightweight store pattern as vehicleState (getState/setState/subscribe +
// useAgent hook). The chat is UI-only; the ONLY place it touches the vehicle is
// through the scripted tools in ./scripts (which call vehicleCommands).
// ---------------------------------------------------------------------------

export type MsgStatus = "thinking" | "calling" | "done" | "interrupted";

export interface AgentMessage {
  id: number;
  role: "user" | "agent";
  text: string; // user: utterance; agent: the spoken response (grows across phases)
  status?: MsgStatus; // agent only
  toolLabel?: string;
  toolResults?: string[];
  toolsOpen?: boolean; // collapsible tool-call block
  final?: string;
  duration?: string;
}

/** Voice-pipeline phase, driven by the integration (window.LiquidCar.agent.setPhase).
 *  `idle` = nothing happening; the rest each get an animated status modal. */
export type AgentPhase = "idle" | "wake" | "voice" | "processing" | "speaking";

export const PHASE_LABEL: Record<Exclude<AgentPhase, "idle">, string> = {
  wake: "Wake word detected",
  voice: "Listening…",
  processing: "Thinking…",
  speaking: "Speaking…",
};

export type LogLevel = "event" | "tool" | "info" | "error";

export interface ConsoleEntry {
  id: number;
  ts: number; // epoch ms
  level: LogLevel;
  text: string;
}

export interface AgentState {
  open: boolean; // panel shown instead of the config sidebar
  input: string;
  listening: boolean; // simulated speech mode (shimmer border)
  busy: boolean; // a response is in flight (input shows the Stop button)
  messages: AgentMessage[];
  playingId: number | null; // agent message whose TTS is "playing"
  playProgress: number; // 0..1 karaoke progress for the playing message
  // Voice-agent runtime (driven by the LLM integration via window.LiquidCar)
  phase: AgentPhase;
  micMuted: boolean;
  transcript: string; // live user speech transcript
  consoleLog: ConsoleEntry[];
  consoleOpen: boolean;
  // Real browser-mic streaming (distinct from the simulated `listening`/`micMuted`):
  micStreaming: boolean; // continuous-mic toggle — DEFAULT OFF (privacy)
  pttActive: boolean; // hold-to-talk currently held
  micPermission: MicPermission; // permission / capture status for UI feedback
}

/** Browser-mic permission / capture status surfaced in the UI. */
export type MicPermission = "unknown" | "granted" | "denied" | "error";

const initial: AgentState = {
  open: false,
  input: "",
  listening: false,
  busy: false,
  messages: [],
  playingId: null,
  playProgress: 0,
  phase: "idle",
  micMuted: false,
  transcript: "",
  consoleLog: [],
  consoleOpen: false,
  micStreaming: false,
  pttActive: false,
  micPermission: "unknown",
};

let state: AgentState = initial;
const listeners = new Set<() => void>();

export function getAgentState(): AgentState {
  return state;
}

function set(patch: Partial<AgentState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeAgent(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAgent<T>(selector: (s: AgentState) => T): T {
  return useSyncExternalStore(subscribeAgent, () => selector(state), () => selector(state));
}

// --- ids + timers -----------------------------------------------------------
let nextId = 1;
let runToken = 0; // bumped to cancel an in-flight (or interrupted) response
const timers = new Set<ReturnType<typeof setTimeout>>();
function after(ms: number, fn: () => void): void {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
}
function clearTimers(): void {
  timers.forEach(clearTimeout);
  timers.clear();
}

function patchMsg(id: number, patch: Partial<AgentMessage>): void {
  set({ messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}

// --- panel + composer -------------------------------------------------------

export function openChat(): void {
  set({ open: true });
}

export function closeChat(): void {
  set({ open: false });
}

export function setInput(input: string): void {
  // Typing exits the simulated speech mode (matches the Figma annotation).
  set({ input, listening: false });
}

// A phrase the simulated mic "hears" and streams into the input word by word.
const SPEECH_PHRASE = "The kids are sleeping in the back, keep them warm.";

export function toggleListening(): void {
  if (state.listening) {
    set({ listening: false });
    return;
  }
  const token = ++runToken;
  set({ listening: true, input: "" });
  const words = SPEECH_PHRASE.split(" ");
  words.forEach((_, i) => {
    after(260 * (i + 1), () => {
      if (token !== runToken || !state.listening) return;
      set({ input: words.slice(0, i + 1).join(" ") });
      if (i === words.length - 1) set({ listening: false });
    });
  });
}

// --- the scripted response flow --------------------------------------------

export function send(): void {
  const text = state.input.trim();
  if (!text || state.busy) return;

  const token = ++runToken;
  const userMsg: AgentMessage = { id: nextId++, role: "user", text };
  const agentMsg: AgentMessage = { id: nextId++, role: "agent", text: "", status: "thinking" };
  set({
    messages: [...state.messages, userMsg, agentMsg],
    input: "",
    listening: false,
    busy: true,
  });

  const script = resolveScript(text);

  // Phase 1 — thinking.
  after(1300, () => {
    if (token !== runToken) return;
    patchMsg(agentMsg.id, { text: script.preamble, status: "calling" });

    // Phase 2 — calling tools (fire the real vehicle commands).
    after(1400, () => {
      if (token !== runToken) return;
      const toolResults = script.run?.();
      patchMsg(agentMsg.id, {
        status: "done",
        toolLabel: script.toolLabel,
        toolResults,
        toolsOpen: true,
        final: script.final,
        duration: script.duration,
      });
      set({ busy: false });
    });
  });
}

/** Stop button — abandon the in-flight response, marking it interrupted. */
export function interrupt(): void {
  if (!state.busy) return;
  runToken++; // cancels pending timers' effects
  clearTimers();
  const last = [...state.messages].reverse().find((m) => m.role === "agent");
  if (last && last.status !== "done") {
    patchMsg(last.id, { status: "interrupted" });
  }
  set({ busy: false });
}

export function toggleTools(id: number): void {
  const m = state.messages.find((x) => x.id === id);
  if (m) patchMsg(id, { toolsOpen: !m.toolsOpen });
}

// --- simulated TTS playback (karaoke highlight, no real audio) --------------

let playTimer: ReturnType<typeof setInterval> | null = null;

function stopPlayback(): void {
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
  set({ playingId: null, playProgress: 0 });
}

export function togglePlay(id: number): void {
  if (state.playingId === id) {
    stopPlayback();
    return;
  }
  if (playTimer) clearInterval(playTimer);
  const msg = state.messages.find((m) => m.id === id);
  const words = playbackText(msg).split(/\s+/).filter(Boolean).length || 1;
  set({ playingId: id, playProgress: 0 });
  const stepMs = 90; // per-word cadence
  let done = 0;
  playTimer = setInterval(() => {
    done += 1;
    if (done >= words) {
      stopPlayback();
    } else {
      set({ playProgress: done / words });
    }
  }, stepMs);
}

/** The text the playback bar reads aloud (preamble + closing line). */
export function playbackText(m?: AgentMessage): string {
  if (!m) return "";
  return [m.text, m.final].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Voice-agent runtime — the surface the real LLM integration drives via
// window.LiquidCar (see ./agentRuntime). These mutate UI-only state (phase,
// mic, transcript, console) and let the assistant post messages into the panel.
// ---------------------------------------------------------------------------

export function setPhase(phase: AgentPhase): void {
  set({ phase });
}

export function setMicMuted(micMuted: boolean): void {
  set({ micMuted });
  if (micMuted && state.phase !== "idle") set({ phase: "idle" });
}

export function toggleMic(): void {
  setMicMuted(!state.micMuted);
}

export function setTranscript(transcript: string): void {
  set({ transcript });
}

// --- real browser-mic streaming state (driven by ./micStreaming) ------------

export function setMicStreaming(micStreaming: boolean): void {
  set({ micStreaming });
}

export function setPttActive(pttActive: boolean): void {
  set({ pttActive });
}

export function setMicPermission(micPermission: MicPermission): void {
  set({ micPermission });
}

export function toggleConsole(): void {
  set({ consoleOpen: !state.consoleOpen });
}

export function clearConsole(): void {
  set({ consoleLog: [] });
}

/** Append a console-log line (timestamped). Kept to the most recent 200 entries. */
export function pushConsole(level: LogLevel, text: string): void {
  const entry: ConsoleEntry = { id: nextId++, ts: Date.now(), level, text };
  const consoleLog = [...state.consoleLog, entry].slice(-200);
  set({ consoleLog });
}

/** Post the user's (spoken or typed) utterance into the transcript as a bubble. */
export function agentUserMessage(text: string): number {
  const msg: AgentMessage = { id: nextId++, role: "user", text };
  set({ messages: [...state.messages, msg], transcript: "" });
  pushConsole("info", `user: ${text}`);
  return msg.id;
}

export interface AgentResponse {
  /** Spoken preamble / main text. */
  text?: string;
  toolLabel?: string;
  toolResults?: string[];
  final?: string;
  duration?: string;
}

/** Post a completed agent response into the transcript (the LLM owns the wording). */
export function agentRespond(r: AgentResponse): number {
  const msg: AgentMessage = {
    id: nextId++,
    role: "agent",
    text: r.text ?? "",
    status: "done",
    toolLabel: r.toolLabel,
    toolResults: r.toolResults,
    toolsOpen: !!r.toolResults?.length,
    final: r.final,
    duration: r.duration,
  };
  set({ messages: [...state.messages, msg] });
  return msg.id;
}
