// A tiny controllable WebSocket double for the bmwRenderer transport tests.
// Not a *.test.ts file, so vitest does not run it as a suite.

export class MockWebSocket {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;

  readyState: number = MockWebSocket.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  /** Everything passed to send(), in order. */
  sent: unknown[] = [];
  /** If set, send() throws this (to exercise the send-throw path). */
  throwOnSend: unknown = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: unknown): void {
    if (this.throwOnSend) throw this.throwOnSend;
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // ── test controls ──────────────────────────────────────────────────────
  /** Simulate the socket opening. */
  fireOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  /** Simulate a socket error. */
  fireError(): void {
    this.onerror?.();
  }
  /** Simulate a remote/unexpected close (fires onclose without our close()). */
  fireClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  /** Deliver an inbound message. */
  fireMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  /** Every instance constructed since the last reset (newest last). */
  static instances: MockWebSocket[] = [];
  static last(): MockWebSocket {
    const i = MockWebSocket.instances.at(-1);
    if (!i) throw new Error("no MockWebSocket constructed");
    return i;
  }
  static reset(): void {
    MockWebSocket.instances = [];
  }
}

/** Install MockWebSocket as the global WebSocket; returns a restore fn. */
export function installMockWebSocket(): () => void {
  const prev = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = MockWebSocket;
  MockWebSocket.reset();
  return () => {
    (globalThis as { WebSocket?: unknown }).WebSocket = prev;
  };
}
