// Unit tests for the pure connection state machine (src/agent/connection.ts).
// Every transition is covered here, headlessly, with no socket in sight.
import { describe, it, expect } from "vitest";
import {
  nextConnectionState,
  isSendable,
  connectionLabel,
  DEFAULT_EMULATOR_URL,
  type ConnectionState,
  type ConnectionEvent,
} from "../src/agent/connection";

const ALL_STATES: ConnectionState[] = [
  "disconnected",
  "connecting",
  "connected",
  "error",
  "reconnecting",
];

describe("nextConnectionState — the happy-path lifecycle", () => {
  it("connect → connecting → open → connected", () => {
    let s: ConnectionState = "disconnected";
    s = nextConnectionState(s, "connect");
    expect(s).toBe("connecting");
    s = nextConnectionState(s, "open");
    expect(s).toBe("connected");
  });

  it("connected → error on a socket error", () => {
    expect(nextConnectionState("connected", "error")).toBe("error");
  });

  it("connected → reconnecting on an unexpected close", () => {
    expect(nextConnectionState("connected", "close")).toBe("reconnecting");
  });

  it("reconnecting → connecting on the next connect attempt", () => {
    expect(nextConnectionState("reconnecting", "connect")).toBe("connecting");
  });

  it("any state → disconnected on an explicit disconnect", () => {
    for (const s of ALL_STATES) {
      expect(nextConnectionState(s, "disconnect")).toBe("disconnected");
    }
  });
});

describe("nextConnectionState — event mapping from every state", () => {
  it("connect always yields connecting", () => {
    for (const s of ALL_STATES) expect(nextConnectionState(s, "connect")).toBe("connecting");
  });

  it("open yields connected from any live state, but is ignored when disconnected (stale)", () => {
    for (const s of ALL_STATES) {
      const expected = s === "disconnected" ? "disconnected" : "connected";
      expect(nextConnectionState(s, "open")).toBe(expected);
    }
  });

  it("error yields error from any live state, but is ignored when disconnected (stale)", () => {
    for (const s of ALL_STATES) {
      const expected = s === "disconnected" ? "disconnected" : "error";
      expect(nextConnectionState(s, "error")).toBe(expected);
    }
  });

  it("close yields reconnecting from any live state, but stays disconnected when disconnected", () => {
    for (const s of ALL_STATES) {
      const expected = s === "disconnected" ? "disconnected" : "reconnecting";
      expect(nextConnectionState(s, "close")).toBe(expected);
    }
  });
});

describe("nextConnectionState — stale-event guard", () => {
  it("a late open after disconnect does NOT resurrect the connection", () => {
    expect(nextConnectionState("disconnected", "open")).toBe("disconnected");
  });
  it("a late error/close after disconnect stays disconnected", () => {
    expect(nextConnectionState("disconnected", "error")).toBe("disconnected");
    expect(nextConnectionState("disconnected", "close")).toBe("disconnected");
  });
});

describe("nextConnectionState — totality", () => {
  it("returns a valid state for every (state, event) pair", () => {
    const events: ConnectionEvent[] = ["connect", "open", "error", "close", "disconnect"];
    for (const s of ALL_STATES) {
      for (const e of events) {
        expect(ALL_STATES).toContain(nextConnectionState(s, e));
      }
    }
  });
});

describe("isSendable", () => {
  it("is true ONLY when connected", () => {
    for (const s of ALL_STATES) expect(isSendable(s)).toBe(s === "connected");
  });
});

describe("connectionLabel", () => {
  it("gives a human label for every state", () => {
    for (const s of ALL_STATES) {
      expect(connectionLabel(s)).toBeTruthy();
      expect(typeof connectionLabel(s)).toBe("string");
    }
  });
  it("labels are distinct per state", () => {
    const labels = ALL_STATES.map(connectionLabel);
    expect(new Set(labels).size).toBe(ALL_STATES.length);
  });
});

describe("DEFAULT_EMULATOR_URL", () => {
  it("is a ws:// URL", () => {
    expect(DEFAULT_EMULATOR_URL).toMatch(/^wss?:\/\//);
  });
});
