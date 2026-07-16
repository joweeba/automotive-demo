import { useEffect, useState } from "react";
import { useAgent } from "../../agent/agentStore";
import { connect, disconnect } from "../../agent/bmwRenderer";
import {
  connectionLabel,
  DEFAULT_EMULATOR_URL,
  type ConnectionState,
} from "../../agent/connection";

// ---------------------------------------------------------------------------
// ConnectionStatus — the visible emulator-WebSocket connection indicator.
//
// The core UX bug this fixes: the UI used to look "all is well" even when the
// socket was down, so the user would toggle the mic / hold PTT and nothing would
// happen (sends dropped into a closed socket, silently). This makes the state
// OBVIOUS — a coloured status dot + label, the reason when not connected, a
// dropped-audio warning, and a connect field (pre-filled with a sensible default)
// so there is always a clear way to connect.
// ---------------------------------------------------------------------------

/** Dot + text tone per state (Tidal status tokens). */
const TONE: Record<ConnectionState, { dot: string; text: string; pulse: boolean }> = {
  connected: { dot: "bg-status-success", text: "text-status-success", pulse: false },
  connecting: { dot: "bg-status-warning", text: "text-status-warning", pulse: true },
  reconnecting: { dot: "bg-status-warning", text: "text-status-warning", pulse: true },
  error: { dot: "bg-status-error", text: "text-status-error", pulse: false },
  disconnected: { dot: "bg-muted-foreground", text: "text-muted-foreground", pulse: false },
};

export function ConnectionStatus() {
  const connection = useAgent((s) => s.connection);
  const connectionUrl = useAgent((s) => s.connectionUrl);
  const connectionReason = useAgent((s) => s.connectionReason);
  const audioDropped = useAgent((s) => s.audioDropped);

  const [url, setUrl] = useState(connectionUrl ?? DEFAULT_EMULATOR_URL);
  // Keep the field in sync when the store URL changes (e.g. a ?emulator= auto-connect
  // set it before this mounted) so a later Connect/Retry targets the RIGHT host, not
  // the stale default. connectionUrl is null while disconnected, so this never
  // clobbers what the user is typing into the connect field.
  useEffect(() => {
    if (connectionUrl) setUrl(connectionUrl);
  }, [connectionUrl]);
  const tone = TONE[connection];
  const isConnected = connection === "connected";
  const busy = connection === "connecting" || connection === "reconnecting";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-input bg-secondary/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot} ${
            tone.pulse ? "mic-rec-dot" : ""
          }`}
        />
        <span
          role="status"
          aria-live="polite"
          className={`text-sm font-medium ${tone.text}`}
        >
          {connectionLabel(connection)}
        </span>
        {(isConnected || busy) && connectionUrl && (
          <span className="ml-auto truncate text-xs text-muted-foreground" title={connectionUrl}>
            {connectionUrl}
          </span>
        )}
      </div>

      {/* Reason when not connected — makes the failure mode explicit. */}
      {!isConnected && connectionReason && (
        <p className="text-xs text-muted-foreground">{connectionReason}</p>
      )}

      {/* Dropped-audio warning — the previously-silent failure, now visible. Only
          while NOT connected, so it can't contradict a healthy connection after a
          reconnect (the count clears on the next stream start). */}
      {audioDropped > 0 && !isConnected && (
        <p className="text-xs text-status-warning">
          {audioDropped}+ audio frame{audioDropped === 1 ? "" : "s"} dropped — not connected.
        </p>
      )}

      {/* Connect / disconnect controls. */}
      {isConnected ? (
        <button
          type="button"
          onClick={() => disconnect()}
          className="self-start rounded-full border border-input bg-secondary px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary/80"
        >
          Disconnect
        </button>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = url.trim();
            if (trimmed) connect(trimmed);
          }}
        >
          <input
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={DEFAULT_EMULATOR_URL}
            aria-label="Emulator WebSocket URL"
            className="min-w-0 flex-1 rounded-full border border-input bg-background px-3 py-1 text-xs text-foreground outline-none focus:border-[var(--agent-accent)]"
          />
          <button
            type="submit"
            disabled={!url.trim()}
            className="shrink-0 rounded-full border border-transparent bg-[var(--agent-accent)] px-3 py-1 text-xs font-medium text-white transition-opacity disabled:opacity-40"
          >
            {busy ? "Retry" : "Connect"}
          </button>
        </form>
      )}
    </div>
  );
}
