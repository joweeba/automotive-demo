import { Environment, Lightformer } from "@react-three/drei";

/**
 * Image-Based Lighting for the "ray-traced" look, built entirely from procedural
 * `<Lightformer>` panels — no external HDRI fetch, so it works offline and inside
 * a strict CSP. The panels are baked into a cubemap once (`frames={1}`) and set as
 * `scene.environment` only (never the background — the canvas stays transparent so
 * the app gradient shows through as sky). This is what the car paint, chrome and
 * glass reflect; combined with soft shadows + ACES tone mapping it reads as a
 * real-time ray-traced studio render.
 *
 * Layout is the classic automotive studio rig: a broad soft key overhead-front,
 * two vertical rim strips down the sides (the long streak highlights that define a
 * car's shoulders), a cool fill behind, and a dim ground bounce.
 */
export function SceneEnvironment() {
  return (
    <Environment resolution={512} frames={1} environmentIntensity={0.4}>
      {/* Broad warm key, high and in front, angled down at the hood. */}
      <Lightformer
        form="rect"
        intensity={3.2}
        color="#fff4e6"
        position={[0, 7, 5]}
        rotation={[-Math.PI / 3, 0, 0]}
        scale={[12, 8, 1]}
      />
      {/* Overhead soft box for even top reflections. */}
      <Lightformer
        form="rect"
        intensity={1.6}
        color="#ffffff"
        position={[0, 9, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[10, 10, 1]}
      />
      {/* Side rim strips — the long vertical streaks along the body shoulders. */}
      <Lightformer
        form="rect"
        intensity={2.4}
        color="#dce6ff"
        position={[7, 3, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[10, 4, 1]}
      />
      <Lightformer
        form="rect"
        intensity={2.4}
        color="#dce6ff"
        position={[-7, 3, 0]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[10, 4, 1]}
      />
      {/* Cool fill from behind to separate the rear from the sky. */}
      <Lightformer
        form="rect"
        intensity={1.2}
        color="#acc4e6"
        position={[0, 4, -8]}
        rotation={[Math.PI / 4, 0, 0]}
        scale={[10, 5, 1]}
      />
      {/* Dim ground bounce so the underside/wheels aren't pitch black. */}
      <Lightformer
        form="rect"
        intensity={0.5}
        color="#8a8f99"
        position={[0, -2, 2]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[14, 14, 1]}
      />
    </Environment>
  );
}
