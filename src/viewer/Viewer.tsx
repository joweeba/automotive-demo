import { Canvas } from "@react-three/fiber";
import { SoftShadows } from "@react-three/drei";
import { Suspense, useCallback, useState } from "react";
import * as THREE from "three";
import { Sedan } from "./Sedan";
import { CameraRig } from "./CameraRig";
import { SceneEnvironment } from "./SceneEnvironment";
import { Ground } from "./Ground";
import { Rain } from "./Rain";
import { useVehicle } from "../state/vehicleState";

/** The 3D stage: transparent (the app gradient shows through) with a studio look —
 *  IBL environment + soft shadows + ACES tone mapping (reflections), a selectable
 *  reflective ground that fades into an atmospheric backdrop, wind-driven rain when
 *  the wiper is on, and the preset camera. `padRight` is the floating panel's
 *  footprint so the camera keeps the car composed left of it. */
export function Viewer({ padRight = 0, zoom = 1 }: { padRight?: number; zoom?: number }) {
  const view = useVehicle((s) => s.view);
  const [center, setCenter] = useState<THREE.Vector3>();
  const handleCenter = useCallback((c: THREE.Vector3) => setCenter(c), []);

  // Neutral dark backdrop the ground dissolves into (studio-infinity fade).
  const fogColor = "#161616";

  return (
    <Canvas
      camera={{ fov: 40, near: 0.05, far: 100, position: [6, 4, 6] }}
      dpr={[1, 2]}
      shadows
      gl={{
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.9,
      }}
    >
      {/* No scene background — the canvas is transparent over the app gradient.
          Exponential fog eases the ground into the dark backdrop (no hard edge). */}
      <fogExp2 attach="fog" args={[fogColor, 0.05]} />

      {/* Percentage-closer soft shadows: contact-hard near the tyres, softening with
          distance — the penumbra that sells a ray-traced ground contact. */}
      <SoftShadows size={26} samples={16} focus={0.6} />

      {/* Image-based lighting drives the reflections on paint / chrome / glass. */}
      <SceneEnvironment />

      {/* Ambient + fill rig. The key light casts the ground shadow; ambient is kept low
          so the cast shadow reads deep against the reflective floor. */}
      <hemisphereLight args={[0xffffff, 0x141414, 0.22]} />
      <directionalLight
        position={[4, 8, 3]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
      />
      <directionalLight position={[-4, 2, -3]} intensity={0.12} />

      <Suspense fallback={null}>
        <Sedan onCenter={handleCenter} />
        <Ground />
      </Suspense>

      <Rain />

      <CameraRig view={view} center={center} padRight={padRight} zoom={zoom} />
    </Canvas>
  );
}
