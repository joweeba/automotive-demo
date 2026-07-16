// ---------------------------------------------------------------------------
// connection — the emulator-WebSocket connection state machine.
//
// The web renderer talks to the emulator over ONE WebSocket (see bmwRenderer).
// Before this module the UI gave a false "all is well" impression when that
// socket was down (the car just sat there and mic/PTT sends were dropped into a
// closed socket, silently). This FSM makes the connection state explicit,
// observable (via agentStore), and rendered, so a down/errored link is obvious
// and the mic controls can be disabled until we are actually connected.
//
// The reducer here is PURE (no sockets, no store) so every transition is unit
// testable; bmwRenderer feeds it real socket lifecycle events and mirrors the
// resulting state into agentStore.
// ---------------------------------------------------------------------------

/** A sensible default emulator bridge URL, offered in the connect field so the
 *  user is never silently disconnected with no obvious way to connect. */
export const DEFAULT_EMULATOR_URL = "ws://localhost:8787";

/** The five observable connection states surfaced to the UI. */
export type ConnectionState =
  | "disconnected" // no socket, and we are not trying to open one
  | "connecting" // a socket has been created; awaiting onopen
  | "connected" // socket open — safe to send control/audio
  | "error" // the socket errored (onerror); a close/reconnect usually follows
  | "reconnecting"; // socket closed unexpectedly; a reconnect is scheduled

/** Lifecycle events bmwRenderer feeds the reducer as the socket transitions. */
export type ConnectionEvent =
  | "connect" // connect(url) / openSocket() created a socket → connecting
  | "open" // ws.onopen fired → connected
  | "error" // ws.onerror fired → error
  | "close" // ws.onclose fired while we still want the URL → reconnecting
  | "disconnect"; // disconnect() called (or open failed with nothing scheduled)

/**
 * Pure transition: given the current state and an event, return the next state.
 *
 * Total and deterministic. `open`/`error`/`close` arriving while `disconnected`
 * are treated as STALE (a late callback from a socket we already tore down) and
 * ignored — the caller nulls handlers on disconnect, but this is belt-and-braces
 * so a stale event can never resurrect a connection the user closed.
 */
export function nextConnectionState(
  current: ConnectionState,
  event: ConnectionEvent,
): ConnectionState {
  switch (event) {
    case "connect":
      return "connecting";
    case "disconnect":
      return "disconnected";
    case "open":
      return current === "disconnected" ? "disconnected" : "connected";
    case "error":
      return current === "disconnected" ? "disconnected" : "error";
    case "close":
      // A close after an explicit disconnect stays disconnected; otherwise the
      // transport intends to retry, so we surface "reconnecting".
      return current === "disconnected" ? "disconnected" : "reconnecting";
    default: {
      // Exhaustiveness guard: if a new event type is added the compiler flags
      // this. At runtime an unknown event leaves the state unchanged.
      const _exhaustive: never = event;
      void _exhaustive;
      return current;
    }
  }
}

/** True only when the socket is open and it is safe to send control/audio. */
export function isSendable(state: ConnectionState): boolean {
  return state === "connected";
}

/** Human-readable one-liner for the UI badge / disabled-reason text. */
export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "error":
      return "Connection error";
    case "disconnected":
      return "Not connected";
  }
}
