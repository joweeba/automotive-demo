// ---------------------------------------------------------------------------
// micCapture — main-thread controller for browser mic capture.
//
// Wraps getUserMedia + Web Audio + the AudioWorklet (see ./micWorklet). Each
// captured frame (16 kHz PCM16 LE) is handed to the caller-supplied onFrame
// callback, which forwards it to bmwRenderer.sendAudio.
//
// Web Audio cross-browser quirks (Chrome's autoplay-suspend, Safari differences,
// worklet-module loading) are smoothed over by `standardized-audio-context`
// (MIT). We STILL keep src/audio/pcm.ts as the single tested source of truth for
// the resample/convert (it is embedded verbatim into the worklet).
//
// Testability: the browser primitives (getUserMedia, the AudioContext + worklet
// constructors, Blob-URL creation) are injected via a `CaptureEnv` seam. The
// default env binds the real standardized-audio-context + navigator; unit tests
// inject fakes so the graph-setup + error-mapping logic is exercised headlessly.
// The graph-wiring + error mapping itself lives HERE (not in the env) so it is
// what the tests actually cover.
//
// Privacy: nothing here runs until start() is called (never auto-started).
// ---------------------------------------------------------------------------

import { AudioContext, AudioWorkletNode } from "standardized-audio-context";
import { MIC_WORKLET_NAME, buildWorkletSource } from "./micWorklet";

export type MicCaptureError = "denied" | "unsupported" | "failed";

export class MicCaptureException extends Error {
  constructor(
    public readonly kind: MicCaptureError,
    message: string,
  ) {
    super(message);
    this.name = "MicCaptureException";
  }
}

// ── the injectable seam ─────────────────────────────────────────────────────
// Structural interfaces capturing ONLY what we use, so tests can supply tiny
// fakes and the real standardized-audio-context types slot in structurally.

/** The subset of an AudioContext this module drives. */
export interface CaptureContext {
  readonly state: string;
  resume(): Promise<void>;
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  createMediaStreamSource(stream: MediaStream): {
    connect(dest: unknown): void;
    disconnect(): void;
  };
  readonly destination: unknown;
  close(): Promise<void> | void;
}

/** The subset of an AudioWorkletNode this module drives. */
export interface CaptureNode {
  readonly port: { onmessage: ((ev: MessageEvent) => void) | null };
  connect(dest: unknown): void;
  disconnect(): void;
}

/** Injectable browser primitives. Everything is required in a real env; the
 *  default binds them from window/navigator + standardized-audio-context. */
export interface CaptureEnv {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createContext?: () => CaptureContext;
  createNode?: (
    ctx: CaptureContext,
    name: string,
    options: { processorOptions: Record<string, unknown> },
  ) => CaptureNode;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

/** Build the default env from the real browser + standardized-audio-context. */
export function defaultCaptureEnv(): CaptureEnv {
  const hasNavigator =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  // standardized-audio-context normalises AudioContext across browsers, but both
  // exports are undefined in a non-Web-Audio env. Leave createContext/createNode
  // UNDEFINED in that case so the startCapture() support guard maps it to an
  // "unsupported" error BEFORE ever prompting for the mic.
  const Ctx = AudioContext as unknown as (new () => CaptureContext) | undefined;
  const Node = AudioWorkletNode as unknown as
    | (new (ctx: unknown, name: string, options: unknown) => CaptureNode)
    | undefined;
  const hasObjectURL = typeof URL !== "undefined" && !!URL.createObjectURL;
  return {
    getUserMedia: hasNavigator
      ? (c) => navigator.mediaDevices.getUserMedia(c)
      : undefined,
    createContext: Ctx ? () => new Ctx() : undefined,
    createNode: Node ? (ctx, name, options) => new Node(ctx, name, options) : undefined,
    createObjectURL: hasObjectURL ? (blob) => URL.createObjectURL(blob) : undefined,
    revokeObjectURL: hasObjectURL ? (url) => URL.revokeObjectURL(url) : undefined,
  };
}

interface Session {
  stream: MediaStream;
  ctx: CaptureContext;
  source: { disconnect(): void };
  node: CaptureNode;
}

let session: Session | null = null;

/** True while the mic is actively capturing (worklet running). */
export function isCapturing(): boolean {
  return session != null;
}

/**
 * Start mic capture. Resolves once audio is flowing; each frame is delivered to
 * `onFrame` as an Int16Array (16 kHz mono PCM16 LE). Throws a
 * MicCaptureException on permission denial or unsupported environment — callers
 * surface that as a UI state (they must NOT wedge, and NOTHING is swallowed).
 *
 * `env` is injectable for testing; production callers omit it.
 */
export async function startCapture(
  onFrame: (pcm16: Int16Array) => void,
  env: CaptureEnv = defaultCaptureEnv(),
): Promise<void> {
  if (session) return; // already capturing (idempotent)

  const { getUserMedia, createContext, createNode, createObjectURL, revokeObjectURL } = env;
  if (!getUserMedia || !createContext || !createNode || !createObjectURL) {
    throw new MicCaptureException(
      "unsupported",
      "Web Audio / getUserMedia unavailable in this environment",
    );
  }

  let stream: MediaStream;
  try {
    stream = await getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (
      name === "NotAllowedError" ||
      name === "SecurityError" ||
      name === "PermissionDeniedError"
    ) {
      throw new MicCaptureException("denied", "Microphone permission denied");
    }
    throw new MicCaptureException("failed", `getUserMedia failed: ${String(err)}`);
  }

  let ctx: CaptureContext | null = null;
  try {
    ctx = createContext();
    // Chrome starts the context suspended until a user gesture; startCapture is
    // called from the mic/PTT click, so resume here (and again after wiring) to
    // reliably get audio flowing — a prime suspect for "no audio in Chrome".
    await resumeIfNeeded(ctx);

    const blob = new Blob([buildWorkletSource()], { type: "application/javascript" });
    const workletUrl = createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(workletUrl);
    } finally {
      // addModule has fetched the module by now; revoke so we don't leak one blob
      // URL per start (mic toggle / every PTT press) for the page lifetime.
      revokeObjectURL?.(workletUrl);
    }

    const source = ctx.createMediaStreamSource(stream);
    const node = createNode(ctx, MIC_WORKLET_NAME, {
      processorOptions: { targetRate: 16000 },
    });
    node.port.onmessage = (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) onFrame(new Int16Array(ev.data));
    };
    source.connect(node);
    // Keep the graph pulling without emitting audible output: connect to the
    // destination so the AudioWorklet processor is scheduled (it must be in the
    // render graph to run).
    node.connect(ctx.destination);

    // Belt-and-braces: after wiring, ensure the context is actually running.
    await resumeIfNeeded(ctx);
    if (ctx.state === "suspended") {
      console.warn(
        "[mic] AudioContext is still suspended after resume — audio may not flow until a user gesture",
      );
    }

    session = { stream, ctx, source, node };
  } catch (err) {
    // Tear down partial state and RETHROW (never swallow — the caller maps this
    // to a UI error state via micStreaming).
    stream.getTracks().forEach((t) => t.stop());
    if (ctx) {
      try {
        void ctx.close();
      } catch (closeErr) {
        console.warn("[mic] context close during failed setup also failed:", closeErr);
      }
    }
    throw new MicCaptureException("failed", `audio graph setup failed: ${String(err)}`);
  }
}

/** Resume the context if it isn't already running. Surfaces (never swallows) failures. */
async function resumeIfNeeded(ctx: CaptureContext): Promise<void> {
  if (ctx.state === "running") return;
  try {
    await ctx.resume();
  } catch (err) {
    // Not fatal on its own (some browsers reject resume() off-gesture), but never
    // silent — surface so a "no audio" investigation can see it.
    console.warn("[mic] AudioContext.resume() failed:", err);
  }
}

/** Stop mic capture and release the mic. Idempotent. */
export function stopCapture(): void {
  if (!session) return;
  const { stream, ctx, source, node } = session;
  session = null;
  try {
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  } catch (err) {
    // Best-effort teardown — but never a silent swallow (owner directive).
    console.warn("[mic] teardown encountered an error (mic released best-effort):", err);
  }
}

/** Test hook — force the capture session to null without touching a real graph. */
export function _resetForTest(): void {
  session = null;
}
