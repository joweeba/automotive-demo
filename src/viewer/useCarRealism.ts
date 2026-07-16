import { useEffect } from "react";
import * as THREE from "three";

// Upgrades the loaded GLB for the "ray-traced-looking" real-time pipeline:
//  • every real car mesh casts AND receives shadows (self-shadowing under the
//    key light lands on the ground plane and on the car itself),
//  • standard materials get a boosted `envMapIntensity` so the paint, chrome and
//    glass actually mirror the IBL environment (this is what reads as ray-traced).
// FX overlays (light beams, glow, seat sprites) are flagged `userData.isFx` and
// skipped — they must stay additive/unlit, not become shadow casters.

// Metallic paint + glass want punchier reflections than matte trim.
const ENV_INTENSITY = 1.35;

export function useCarRealism(scene: THREE.Object3D) {
  useEffect(() => {
    // Recursive prune (not scene.traverse): bail on the whole FX subtree so beam/glow
    // planes under an `isFx` group never become shadow casters — their transparent
    // geometry would otherwise throw hard rectangular shadows on the ground.
    const visit = (o: THREE.Object3D) => {
      if (o.userData?.isFx) return;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry && !(mesh as unknown as THREE.Sprite).isSprite) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          if (std && "envMapIntensity" in std) std.envMapIntensity = ENV_INTENSITY;
        }
      }
      for (const c of o.children) visit(c);
    };
    visit(scene);
  }, [scene]);
}
