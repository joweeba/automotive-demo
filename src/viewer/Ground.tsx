import { MeshReflectorMaterial } from "@react-three/drei";
import { useMemo } from "react";
import { useVehicle } from "../state/vehicleState";
import { getGroundResources } from "./groundMaterials";

// A large ground plane the car sits on, using a real-time reflection material
// (MeshReflectorMaterial renders the scene into the surface each frame) so the car
// is mirrored in polished surfaces. The surface material is selectable from the
// sidebar; each maps to a procedural PBR texture set + reflection tuning. When the
// wipers are running (rain) the surface reads a touch wetter — glossier + more
// reflective — which sells the rain.

const GROUND_SIZE = 60;

export function Ground() {
  const ground = useVehicle((s) => s.ground);
  const wiper = useVehicle((s) => s.wiper);
  const weather = useVehicle((s) => s.environment.weather);
  // effectiveWiper without a full VehicleState: on if forced on, or auto in rain.
  const wet = wiper === "on" || (wiper === "auto" && weather === "rain");

  // "none" hides the ground; still call the hook (with any real id) so hook order is
  // stable, then bail before rendering the plane.
  const hidden = ground === "none";
  const res = useMemo(() => getGroundResources(hidden ? "asphalt" : ground), [ground, hidden]);
  const r = res.reflector;

  // Global reflectivity dampening — the surfaces read as matte-ish real flooring, not a
  // mirror (Delora): scale down the mirror + reflection-blend strength and lift roughness.
  const REFLECT = 0.55;

  // Wet surfaces get glossier (lower roughness) and a touch more mirror-like, but roughness
  // isn't pushed all the way down — a near-mirror surface throws a blinding specular
  // hotspot from the key light; more roughness spreads + dims that glint.
  const roughness = (wet ? r.roughness * 0.82 : r.roughness) * 1.12;
  const mirror = Math.min(0.8, (wet ? r.mirror * 1.2 : r.mirror) * REFLECT);
  const mixStrength = (wet ? r.mixStrength * 1.15 : r.mixStrength) * REFLECT;

  if (hidden) return null;

  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-0.001} receiveShadow>
      <planeGeometry args={[GROUND_SIZE, GROUND_SIZE, 1, 1]} />
      <MeshReflectorMaterial
        // A fresh key per material forces drei to rebuild cleanly on swap.
        key={ground}
        resolution={1024}
        map={res.map}
        roughnessMap={res.roughnessMap}
        normalMap={res.normalMap}
        normalScale={[res.normalScale, res.normalScale]}
        roughness={roughness}
        metalness={r.metalness}
        mirror={mirror}
        mixStrength={mixStrength}
        mixBlur={r.mixBlur}
        mixContrast={r.mixContrast}
        blur={r.blur}
        depthScale={r.depthScale}
        minDepthThreshold={0.4}
        maxDepthThreshold={1.4}
        color="#ffffff"
      />
    </mesh>
  );
}
