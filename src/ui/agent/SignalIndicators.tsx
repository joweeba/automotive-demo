import { useSignals, SIGNAL_KINDS, SIGNAL_LABEL, type SignalKind } from "../../agent/signalStore";

// ---------------------------------------------------------------------------
// SignalIndicators — a little green light per momentary front-end signal (VAD,
// wake word, listening, PTT, barge-in). Each lights the instant its `activation`
// event arrives (signalStore.flashSignal) and DECAYS after ~1s; the `.signal-light`
// opacity transition in index.css turns that fall into a smooth timed fade.
//
// Brand-agnostic: it renders the same for BMW or Mercedes (the signals are pipeline
// stages, not cabin state). Always mounted; the dots sit dim until a signal fires.
// ---------------------------------------------------------------------------

function Light({ kind, lit, detail }: { kind: SignalKind; lit: boolean; detail: string }) {
  const title = detail ? `${SIGNAL_LABEL[kind]}: ${detail}` : SIGNAL_LABEL[kind];
  return (
    <div
      className={`signal-light flex items-center gap-1.5 ${lit ? "lit" : ""}`}
      title={title}
      data-signal={kind}
      data-lit={lit}
    >
      <span
        className="h-2.5 w-2.5 rounded-full bg-emerald-400"
        style={lit ? { boxShadow: "0 0 8px 2px rgba(52, 211, 153, 0.9)" } : undefined}
      />
      <span className="text-[11px] font-medium uppercase tracking-wide text-foreground/80">
        {SIGNAL_LABEL[kind]}
      </span>
    </div>
  );
}

export function SignalIndicators() {
  const sig = useSignals((s) => s);
  return (
    <div className="pointer-events-none flex items-center gap-3 rounded-full bg-black/30 px-3 py-2 backdrop-blur-sm">
      {SIGNAL_KINDS.map((k) => (
        <Light key={k} kind={k} lit={sig[k].lit} detail={sig[k].detail} />
      ))}
    </div>
  );
}
