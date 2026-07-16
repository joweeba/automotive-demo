import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useCarRig } from "./useCarRig";
import { useCarRealism } from "./useCarRealism";
import { useCabinReveal } from "./useCabinReveal";
import { useClimateEffects } from "./useClimateEffects";
import { useSeatIcons } from "./useSeatIcons";
import { useLights } from "./useLights";

const MODEL_URL = "/models/sedan_animated_gray.glb";

/**
 * Loads the rigged sedan GLB and renders it as-is. Drives all state-bound effects
 * — mechanical pivots (useCarRig), cabin roof/glass dissolve (useCabinReveal),
 * climate glow + wind (useClimateEffects), seat-heat sprites (useSeatIcons), and
 * head/tail/fog light beams + emissive lamps (useLights) — and reports its
 * bounding-box centre so the camera rig can orbit the real model. Node
 * names are never renamed; all behaviour binds by them (CLAUDE.md rig contract).
 */
export function Sedan({ onCenter }: { onCenter?: (center: THREE.Vector3) => void }) {
  const { scene } = useGLTF(MODEL_URL);

  // Camera orbit centre = the BARE car's bounding-box centre. Effect hooks add overlay
  // geometry (light beams reaching ~8m forward, glow planes, seat sprites) to the same
  // scene, which would badly skew a naive setFromObject — so we prune any subtree flagged
  // `userData.isFx` and skip sprites. Robust regardless of when this runs.
  const center = useMemo(() => {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    const visit = (o: THREE.Object3D) => {
      if (o.userData?.isFx) return; // skip effect overlays
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        tmp.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
        box.union(tmp);
      }
      for (const child of o.children) visit(child);
    };
    visit(scene);
    return box.getCenter(new THREE.Vector3());
  }, [scene]);

  useCarRig(scene);
  useCarRealism(scene); // shadows + envMap on the real car meshes (skips FX overlays)
  useCabinReveal(scene);
  useClimateEffects(scene);
  useSeatIcons(scene);
  useLights(scene);

  useEffect(() => {
    onCenter?.(center);
  }, [center, onCenter]);

  return <primitive object={scene} />;
}

useGLTF.preload(MODEL_URL);
