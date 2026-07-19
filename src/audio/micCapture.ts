// ---------------------------------------------------------------------------
// micCapture — main-thread controller for browser mic capture.
//
// Wraps getUserMedia + Web Audio + the AudioWorklet (see ./micWorklet). Not
// headless-testable (needs real Web Audio); the tested logic lives in ./pcm.
// Exposes start/stop; each captured frame (16 kHz PCM16 LE) is handed to the
// caller-supplied onFrame callback, which forwards it to bmwRenderer.sendAudio.
//
// Privacy: nothing here runs until start() is called (never auto-started).
// ---------------------------------------------------------------------------

import { MIC_WORKLET_NAME, buildWorkletSource } from "./micWorklet";

export type MicCaptureError = "denied" | "unsupported" | "failed";

export class MicCaptureException extends Error {
  constructor(public readonly kind: MicCaptureError, message: string) {
    super(message);
    this.name = "MicCaptureException";
  }
}

interface Session {
  stream: MediaStream;
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
}

let session: Session | null = null;
let workletUrl: string | null = null;

/** True while the mic is actively capturing (worklet running). */
export function isCapturing(): boolean {
  return session != null;
}

/**
 * Start mic capture. Resolves once audio is flowing; each frame is delivered to
 * `onFrame` as an Int16Array (16 kHz mono PCM16 LE). Throws a
 * MicCaptureException on permission denial or unsupported environment — callers
 * surface that as a UI state (they must NOT wedge).
 */
export async function startCapture(onFrame: (pcm16: Int16Array) => void): Promise<void> {
  if (session) return; // already capturing (idempotent)

  const AudioCtx =
    typeof window !== "undefined"
      ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    !AudioCtx
  ) {
    throw new MicCaptureException("unsupported", "Web Audio / getUserMedia unavailable");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
      throw new MicCaptureException("denied", "Microphone permission denied");
    }
    throw new MicCaptureException("failed", `getUserMedia failed: ${String(err)}`);
  }

  try {
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") await ctx.resume();

    if (!workletUrl) {
      const blob = new Blob([buildWorkletSource()], { type: "application/javascript" });
      workletUrl = URL.createObjectURL(blob);
    }
    await ctx.audioWorklet.addModule(workletUrl);

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, MIC_WORKLET_NAME, {
      processorOptions: { targetRate: 16000 },
    });
    node.port.onmessage = (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) onFrame(new Int16Array(ev.data));
    };
    source.connect(node);
    // Keep the graph pulling without emitting audible output: a muted sink.
    // (AudioWorklet processors must be in the render graph to run.)
    node.connect(ctx.destination);

    session = { stream, ctx, source, node };
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw new MicCaptureException("failed", `audio graph setup failed: ${String(err)}`);
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
  } catch {
    /* best-effort teardown */
  }
}
