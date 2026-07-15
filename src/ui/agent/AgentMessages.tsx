import { useEffect, useRef } from "react";
import { useAgent, togglePlay, toggleTools } from "../../agent/agentStore";
import type { AgentMessage } from "../../agent/agentStore";
import { LiquidMark } from "../icons";
import { Play, Stop, ChevronDown } from "../icons";

/**
 * Splits text into words+whitespace and lights the first `lit` words. When `stream`,
 * each word fades/blurs in with a staggered delay (ChatGPT/Claude-style token reveal);
 * the animation plays once on mount and doesn't interfere with karaoke lighting.
 */
function Words({ text, lit, stream = false }: { text: string; lit: number; stream?: boolean }) {
  let wi = 0;
  return (
    <>
      {text.split(/(\s+)/).map((tok, i) => {
        if (/^\s+$/.test(tok) || tok === "") return <span key={i}>{tok}</span>;
        const idx = wi++;
        const on = idx < lit;
        return (
          <span
            key={i}
            className={`${on ? "text-foreground" : "text-muted-foreground opacity-40"} ${
              stream ? "stream-word" : ""
            }`}
            style={stream ? { animationDelay: `${idx * 28}ms` } : undefined}
          >
            {tok}
          </span>
        );
      })}
    </>
  );
}

const wordCount = (t?: string) => (t ? t.trim().split(/\s+/).filter(Boolean).length : 0);

/** Fake inference telemetry shown under Thinking…/Calling tools… (matches Figma). */
function Telemetry() {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground opacity-70">
      <span>Context: 2713/9000 · Output: 578 / ∞</span>
      <span>100k tokens · 10s · 44.5 tok/s</span>
    </div>
  );
}

/** Static-ish speech waveform for the playback bar. */
function PlaybackWave({ active }: { active: boolean }) {
  const bars = [4, 2, 8, 10, 6, 8, 4, 4, 2, 8, 10, 6, 8, 4];
  return (
    <div className="flex h-[10px] items-center gap-[2px]">
      {bars.map((h, i) => (
        <span
          key={i}
          className={`w-[2px] rounded-full ${active ? "bg-foreground" : "bg-muted-foreground"}`}
          style={{ height: `${h}px` }}
        />
      ))}
    </div>
  );
}

function AgentBlock({ m }: { m: AgentMessage }) {
  const playingId = useAgent((s) => s.playingId);
  const progress = useAgent((s) => s.playProgress);

  const playing = playingId === m.id;
  const preWords = wordCount(m.text);
  const finalWords = wordCount(m.final);
  const lit = playing ? Math.round(progress * (preWords + finalWords)) : preWords + finalWords;

  return (
    <div className="msg-enter flex w-full flex-col gap-5">
      {/* Agent label */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <LiquidMark className="h-4 w-4 text-foreground" />
        <span className="text-sm">Agent</span>
      </div>

      {m.status === "thinking" ? (
        <>
          <span className="agent-shimmer text-sm italic">Thinking…</span>
          <Telemetry />
        </>
      ) : (
        <>
          {m.text && (
            <p className="text-sm leading-6">
              <Words text={m.text} lit={Math.min(lit, preWords)} stream />
            </p>
          )}

          {m.status === "calling" && (
            <>
              <span className="agent-shimmer text-sm italic">Calling tools…</span>
              <Telemetry />
            </>
          )}

          {m.status === "interrupted" && (
            <span className="text-sm italic text-muted-foreground">Interrupted.</span>
          )}

          {m.status === "done" && (
            <>
              {m.toolLabel && (
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => toggleTools(m.id)}
                    className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronDown
                      size={16}
                      className={`transition-transform ${m.toolsOpen ? "" : "-rotate-90"}`}
                    />
                    {m.toolLabel}
                  </button>
                  {m.toolsOpen && (
                    <div className="flex flex-col gap-1 pl-8 text-sm text-muted-foreground">
                      {m.toolResults?.map((r, i) => <span key={i}>→ {r}</span>)}
                    </div>
                  )}
                </div>
              )}

              {m.final && (
                <p className="text-sm leading-6">
                  <Words text={m.final} lit={Math.max(0, lit - preWords)} stream />
                </p>
              )}

              {/* Playback bar */}
              <div className="flex items-end gap-2.5">
                <button
                  onClick={() => togglePlay(m.id)}
                  aria-label={playing ? "Stop playback" : "Play response"}
                  className="text-foreground transition-opacity hover:opacity-70"
                >
                  {playing ? <Stop size={18} /> : <Play size={18} />}
                </button>
                <PlaybackWave active={playing} />
                <span className="flex-1 text-right text-xs text-muted-foreground">
                  {m.duration}
                </span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The scrolling message area — empty droplet, user bubbles, agent responses. */
export function AgentMessages() {
  const messages = useAgent((s) => s.messages);
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as the conversation grows / phases advance.
  const lastStatus = messages[messages.length - 1]?.status;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastStatus]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LiquidMark className="h-14 w-14 text-muted-foreground opacity-40" />
      </div>
    );
  }

  return (
    <div ref={scroller} className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="msg-enter flex justify-end">
            <div className="max-w-[300px] rounded-[24px] rounded-br-md border border-border bg-secondary px-4 py-2 text-sm text-foreground">
              {m.text}
            </div>
          </div>
        ) : (
          <AgentBlock key={m.id} m={m} />
        ),
      )}
    </div>
  );
}
