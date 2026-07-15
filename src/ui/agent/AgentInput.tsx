import { useAgent, setInput, send, interrupt, toggleListening } from "../../agent/agentStore";
import { Mic, ArrowUp, Stop } from "../icons";

// The composer at the bottom of the agent panel (Figma 123:2751). Looks:
//  • empty / typing — dark pill, white mic circle + subtle send arrow
//  • listening      — purple glow border; the mic becomes a purple square (stop)
//  • busy           — the streamed utterance (muted) + a single white square-stop
const PILL =
  "flex items-end gap-2 rounded-[24px] border border-input bg-secondary py-2 pl-5 pr-2";

/** White circular button (mic / stop) — light fill, dark glyph. */
function LightButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:brightness-90"
    >
      {children}
    </button>
  );
}

/** Subtle send arrow — dark fill, brightens on hover, dims when there's nothing to send. */
function SendButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Send"
      disabled={disabled}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--muted-foreground)]/25 text-foreground transition hover:brightness-125 ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <ArrowUp size={16} />
    </button>
  );
}

export function AgentInput() {
  const input = useAgent((s) => s.input);
  const listening = useAgent((s) => s.listening);
  const busy = useAgent((s) => s.busy);
  const messages = useAgent((s) => s.messages);

  // Busy: show the just-sent utterance (muted) with a single white square-stop.
  if (busy) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return (
      <div className={PILL}>
        <span className="min-w-0 flex-1 truncate py-1 text-sm text-muted-foreground">
          {lastUser?.text}
        </span>
        <LightButton onClick={interrupt} label="Stop">
          <Stop size={15} />
        </LightButton>
      </div>
    );
  }

  const canSend = input.trim().length > 0;

  return (
    <div className={`${PILL} ${listening ? "agent-listening border-transparent" : ""}`}>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={1}
        placeholder='Type or say "Hey Liquid"'
        className="min-w-0 flex-1 resize-none self-center bg-transparent py-1 text-sm leading-6 text-foreground outline-none [field-sizing:content] max-h-32 placeholder:text-muted-foreground"
      />

      {listening ? (
        // Active speech: a purple square that stops listening.
        <button
          type="button"
          onClick={toggleListening}
          aria-label="Stop listening"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--agent-accent)] text-white transition hover:brightness-110"
        >
          <Stop size={13} />
        </button>
      ) : (
        <LightButton onClick={toggleListening} label="Speak to Liquid">
          <Mic size={16} />
        </LightButton>
      )}

      <SendButton onClick={send} disabled={!canSend} />
    </div>
  );
}
