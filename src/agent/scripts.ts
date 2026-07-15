import {
  setClimate,
  setTemperature,
  setSeatHeat,
  setFan,
} from "../state/vehicleCommands";

// ---------------------------------------------------------------------------
// Scripted "agent" responses. LLM tool-calling is deferred, so a tiny intent
// matcher maps the user's utterance to a canned response + a set of REAL
// vehicleCommands (the tools). When the flow "calls tools", `run()` fires them
// so the 3D car actually reacts — the whole point of the demo. Swapping this
// for a live model later means replacing resolveScript with a real tool loop.
// ---------------------------------------------------------------------------

export interface AgentScript {
  /** First line the agent says, before the tools run. */
  preamble: string;
  /** Collapsible header, e.g. "Tool call (2)". Omit for a no-tool reply. */
  toolLabel?: string;
  /** Executes the vehicle commands and returns the "→ …" result lines. */
  run?: () => string[];
  /** Closing line, after the tools have run. */
  final: string;
  /** Static work-duration label shown by the playback bar. */
  duration: string;
}

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));

/** Pick a scripted response for an utterance. Falls back to a help reply. */
export function resolveScript(utterance: string): AgentScript {
  const t = utterance.toLowerCase();

  // "The kids are sleeping in the back, keep them warm."
  if (has(t, "warm", "cold", "freez", "kids", "heat", "chilly")) {
    return {
      preamble:
        "Noted! Allow me to turn on the heat, set an internal temperature to one of your liking, and up the seat heating in the back.",
      toolLabel: "Tool call (2)",
      run: () => {
        setClimate("heat");
        setTemperature(72);
        setSeatHeat("rear", 2);
        return [
          "Heat turned on, Internal temperature set to 72º F.",
          "Seat heaters in back set to L2.",
        ];
      },
      final: "Heat is now on. Please let me know how else I can assist you today!",
      duration: "7.0k tokens · 1m20s · 44.5 tok/s",
    };
  }

  // "It's hot in here" / "cool it down"
  if (has(t, "hot", "cool", "ac", "air condition", "stuffy")) {
    return {
      preamble: "On it — let me cool the cabin down for you.",
      toolLabel: "Tool call (2)",
      run: () => {
        setClimate("ac");
        setFan(true);
        return ["A/C turned on.", "Fan set to on."];
      },
      final: "The A/C is running. Anything else?",
      duration: "4.2k tokens · 0m48s · 44.5 tok/s",
    };
  }

  // Fallback — no tools.
  return {
    preamble: "I can control the climate, seats, lights and more for this vehicle.",
    final: 'Try saying: "The kids are sleeping in the back, keep them warm."',
    duration: "0.3k tokens · 0m02s · 44.5 tok/s",
  };
}
