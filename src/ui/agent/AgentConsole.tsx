import { useEffect, useRef } from "react";
import { useAgent, clearConsole } from "../../agent/agentStore";
import type { LogLevel } from "../../agent/agentStore";
import { Trash } from "../icons";

const LEVEL_COLOR: Record<LogLevel, string> = {
  event: "text-muted-foreground",
  tool: "text-status-info",
  info: "text-foreground",
  warn: "text-status-warning",
  error: "text-status-error",
};

function clock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Collapsible console log at the bottom of the agent panel. Shows timestamped
 * events + tool calls (every window.LiquidCar.invoke is logged here). Toggled from
 * the panel header; rendered only when `consoleOpen`.
 */
export function AgentConsole() {
  const log = useAgent((s) => s.consoleLog);
  const open = useAgent((s) => s.consoleOpen);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, open]);

  if (!open) return null;

  return (
    <div className="flex h-40 shrink-0 flex-col border-t border-sidebar-border bg-[color:var(--sidebar-background)]">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Console · {log.length}
        </span>
        <button
          type="button"
          onClick={clearConsole}
          aria-label="Clear console"
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Trash size={14} /> Clear
        </button>
      </div>
      <div ref={scroller} className="flex-1 overflow-y-auto px-4 pb-3 font-mono text-xs leading-5">
        {log.length === 0 ? (
          <div className="text-muted-foreground opacity-60">No activity yet.</div>
        ) : (
          log.map((e) => (
            <div key={e.id} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground opacity-60">{clock(e.ts)}</span>
              <span className={`min-w-0 break-words ${LEVEL_COLOR[e.level]}`}>{e.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
