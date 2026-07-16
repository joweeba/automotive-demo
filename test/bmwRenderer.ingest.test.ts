// Unit tests for the INBOUND ingest path's no-silent-drops behaviour
// (src/agent/bmwRenderer.ts). The exhaustive mapping is covered by
// variants.integration.test.ts; here we assert that malformed / unexpected input
// is SURFACED (console.warn/error + UI) rather than swallowed.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ingest, reset } from "../src/agent/bmwRenderer";
import { getAgentState, clearConsole } from "../src/agent/agentStore";

function lastConsole() {
  const log = getAgentState().consoleLog;
  return log[log.length - 1];
}

beforeEach(() => {
  reset();
  clearConsole();
  vi.restoreAllMocks();
});

describe("ingest — no silent drops", () => {
  it("a blank line is skipped without noise", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = getAgentState().consoleLog.length;
    ingest("\n   \n");
    expect(warn).not.toHaveBeenCalled();
    expect(getAgentState().consoleLog.length).toBe(before);
  });

  it("a non-protocol line surfaces a warning (console.warn + UI warn)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ingest("this is a stray emulator log line");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(lastConsole().level).toBe("warn");
    expect(lastConsole().text).toContain("non-protocol");
  });

  it("an unparseable JSON-looking line surfaces a warning, not an error", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ingest('{ not valid json');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(lastConsole().level).toBe("warn");
    expect(lastConsole().text).toContain("unparseable");
  });

  it("a non-object event (e.g. a bare number) is surfaced, not swallowed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ingest(42 as unknown as object);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(lastConsole().level).toBe("warn");
  });

  it("an unknown protocol version is refused with an ERROR", () => {
    ingest({ v: 99, event: "snapshot", state: {} });
    expect(lastConsole().level).toBe("error");
    expect(lastConsole().text).toContain("v=99");
  });

  it("a malformed state_change entry is surfaced and skipped (others still applied)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ingest({ v: 2, event: "snapshot", state: {} });
    clearConsole();
    ingest({
      v: 2,
      event: "state_change",
      changes: [
        { to: "true" }, // malformed: no path
        { path: "climate.ac.DRIVER", to: "true" }, // valid
      ],
    });
    expect(warn).toHaveBeenCalled();
    const texts = getAgentState().consoleLog.map((e) => e.text);
    expect(texts.some((t) => t.includes("malformed change"))).toBe(true);
    // the valid change was still applied
    expect(texts.some((t) => t.includes("climate.ac.DRIVER"))).toBe(true);
  });

  it("an unknown event type is surfaced (never silently ignored)", () => {
    ingest({ v: 2, event: "totally_new_event" });
    expect(lastConsole().text).toContain("ignored event");
  });
});
