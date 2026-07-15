import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getState } from "../state/vehicleState";

// Cabin view dissolves the roof + glass so you can see inside. The roof lifts as
// it fades (like the reference); glass fades in place. Ported from the reference,
// extended so glass dissolves (the reference hard-toggled its visibility).
const ROOF_NAMES = ["ROOF_panel", "INTERIOR_headliner"];
const ROOF_LIFT = 0.65; // metres the roof rises as it dissolves

interface DissolvePart {
  mesh: THREE.Mesh;
  material: THREE.Material;
  baseOpacity: number;
  restY: number;
  lift: number; // 0 for glass (fade in place), ROOF_LIFT for roof
}

function isRoof(name: string) {
  return ROOF_NAMES.some((r) => name.startsWith(r));
}
function isGlass(name: string) {
  return name.includes("GLASS") || name.includes("__glass");
}

/**
 * Fades (and lifts) the roof/glass when the camera is in cabin view, restoring
 * them on the way out. Reads `view` live each frame and damps a 0→1 reveal
 * scalar with the reference's `x += (target - x) * (1 - 0.002^dt)`. Materials are
 * cloned before mutating (they're shared across meshes in the GLB).
 */
export function useCabinReveal(scene: THREE.Object3D) {
  const parts = useRef<DissolvePart[]>([]);
  const reveal = useRef(0); // 0 = intact, 1 = fully dissolved

  useEffect(() => {
    const collected: DissolvePart[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const name = mesh.name || "";
      const roof = isRoof(name);
      if (!roof && !isGlass(name)) return;

      const material = mesh.material.clone();
      material.transparent = true;
      mesh.material = material;
      collected.push({
        mesh,
        material,
        baseOpacity: material.opacity,
        restY: mesh.position.y,
        lift: roof ? ROOF_LIFT : 0,
      });
    });
    parts.current = collected;

    if (import.meta.env.DEV && collected.length === 0) {
      console.warn("[cabinReveal] no roof/glass meshes found");
    }

    return () => {
      // Restore intact state if the scene is swapped out.
      for (const p of collected) {
        p.material.opacity = p.baseOpacity;
        p.mesh.position.y = p.restY;
        p.mesh.visible = true;
      }
    };
  }, [scene]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const target = getState().view === "cabin" ? 1 : 0;
    const k = 1 - Math.pow(0.002, dt);
    reveal.current += (target - reveal.current) * k;

    const r = reveal.current;
    for (const p of parts.current) {
      p.material.opacity = p.baseOpacity * (1 - r);
      if (p.lift) p.mesh.position.y = p.restY + p.lift * r;
      p.mesh.visible = r < 0.98;
    }
  });
}
