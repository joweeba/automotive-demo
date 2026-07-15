import { Canvas } from "@react-three/fiber";
import { Suspense, useCallback, useState } from "react";
import * as THREE from "three";
import { Sedan } from "./Sedan";
import { CameraRig } from "./CameraRig";
import { useVehicle } from "../state/vehicleState";

/** The 3D stage: transparent (the app gradient shows through), three-light rig,
 *  the sedan, and the preset camera. `padRight` is the floating panel's footprint
 *  so the camera keeps the car composed left of it. */
export function Viewer({ padRight = 0, zoom = 1 }: { padRight?: number; zoom?: number }) {
  const view = useVehicle((s) => s.view);
  const [center, setCenter] = useState<THREE.Vector3>();
  const handleCenter = useCallback((c: THREE.Vector3) => setCenter(c), []);

  return (
    <Canvas
      camera={{ fov: 40, near: 0.05, far: 100, position: [6, 4, 6] }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
    >
      {/* No scene background — the canvas is transparent over the app gradient. */}

      {/* Three-light rig (hemisphere + key + fill), matching the reference. */}
      <hemisphereLight args={[0xffffff, 0x333333, 0.9]} />
      <directionalLight position={[3, 6, 2]} intensity={0.8} />
      <directionalLight position={[-4, 2, -3]} intensity={0.3} />

      <Suspense fallback={null}>
        <Sedan onCenter={handleCenter} />
      </Suspense>

      <CameraRig view={view} center={center} padRight={padRight} zoom={zoom} />
    </Canvas>
  );
}
