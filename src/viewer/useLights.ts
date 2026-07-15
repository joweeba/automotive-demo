import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getState } from "../state/vehicleState";
import {
  effectiveHeadlights,
  effectiveTaillights,
  effectiveFoglights,
} from "../state/autoResolve";

// Light beams + emissive lamps — ported from the reference viewer. Two visuals per
// lamp group: soft dissolving textured cones (a flat + upright crossed pair of planes
// plus a glow sprite at the source), and an emissive boost on the actual lamp meshes.
// Bound to state: headlights/taillights `=== 'on'` (auto/off render dark), foglights bool.

const HEAD_NAMES = ["headlight-projector", "headlights-drl", "headlights-led", "headlights-cover"];
const TAIL_NAMES = ["taillight", "TRUNK__taillight"];

const HEAD_GLOW = 0xcfc6ee; // cool white
const TAIL_COLOR = 0xe0342c; // red
const FOG_COLOR = 0xf2ecda; // warm white

// Lamp positions + beam dims (reference CONFIG.beams / .headlights).
const HEADLIGHTS: XYZ[] = [
  [0.76, 0.68, 2.08],
  [-0.76, 0.68, 2.08],
];
const TAIL_POSITIONS: XYZ[] = [
  [0.55, 0.85, -2.32],
  [-0.55, 0.85, -2.32],
];
const FOG_POSITIONS: XYZ[] = [
  [0.62, 0.42, 2.18],
  [-0.62, 0.42, 2.18],
];
const BEAM = { length: 6.2, width: 2.7, maxOpacity: 0.42 };
const TAIL = { length: 2.0, width: 1.5, maxOpacity: 0.4 };
const FOG = { length: 4.6, width: 4.0, maxOpacity: 0.8 };

const HEAD_EMISSIVE = 2.2;
const TAIL_EMISSIVE = 2.5;

// Marker so a beam group left behind by a hot-reload (the GLB scene is cached and
// persists across HMR) can be found and removed before we add a fresh one — otherwise
// the orphan's cones stay lit forever, unbound from state.
const BEAM_GROUP = "fx-light-beams";

/** Remove + dispose any beam group(s) still parented to the scene from a prior mount. */
function clearStaleBeams(scene: THREE.Object3D) {
  let stale = scene.getObjectByName(BEAM_GROUP);
  while (stale) {
    scene.remove(stale);
    stale.traverse((o) => {
      const m = o as THREE.Mesh | THREE.Sprite;
      (m as THREE.Mesh).geometry?.dispose?.();
      const mat = (m as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else mat?.dispose();
    });
    stale = scene.getObjectByName(BEAM_GROUP);
  }
}

type XYZ = [number, number, number];
type BeamMat = THREE.Material & { opacity: number; userData: { max: number } };

/** Soft cone: a bright radial core masked to a blurred triangle (apex at the source). */
function beamTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 512;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 14, 6, 128, 14, 500);
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.35, "rgba(255,255,255,0.28)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 512);
  ctx.globalCompositeOperation = "destination-in";
  ctx.filter = "blur(40px)";
  ctx.beginPath(); // soft cone mask, apex at the source
  ctx.moveTo(128, -8);
  ctx.lineTo(20, 520);
  ctx.lineTo(236, 520);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();
  return new THREE.CanvasTexture(cv);
}

/** Round glow blob for the sprite at each lamp source. */
function glowTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

interface Lights {
  group: THREE.Group;
  head: BeamMat[];
  tail: BeamMat[];
  fog: BeamMat[];
  headLamps: THREE.Mesh[];
  tailLamps: THREE.Mesh[];
  disposables: (THREE.Texture | THREE.BufferGeometry | THREE.Material)[];
}

export function useLights(scene: THREE.Object3D) {
  const lights = useRef<Lights | null>(null);

  useEffect(() => {
    clearStaleBeams(scene); // defend against hot-reload orphans on the cached scene
    const group = new THREE.Group();
    group.name = BEAM_GROUP;
    group.userData.isFx = true; // excluded from the model bounding box (camera centring)
    const bt = beamTexture();
    const gt = glowTexture();
    const disposables: Lights["disposables"] = [bt, gt];

    // One lamp group = flat + upright crossed cone planes + a source glow sprite.
    const beamPair = (
      [x, y, z]: XYZ,
      dims: { length: number; width: number; maxOpacity: number },
      color: number,
      dir: 1 | -1, // +1 forward (+Z), -1 rearward
      out: BeamMat[],
    ) => {
      for (const roll of [0, Math.PI / 2]) {
        const geo = new THREE.PlaneGeometry(dims.width, dims.length);
        const mat = new THREE.MeshBasicMaterial({
          map: bt,
          color,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        mat.userData = { max: dims.maxOpacity };
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = dir > 0 ? -Math.PI / 2 : Math.PI / 2; // source end at the lamp
        m.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), roll);
        m.position.set(x, y, z + (dir * dims.length) / 2);
        group.add(m);
        out.push(mat as unknown as BeamMat);
        disposables.push(geo, mat);
      }
      const smat = new THREE.SpriteMaterial({
        map: gt,
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      smat.userData = { max: Math.min(1, dims.maxOpacity * 2) };
      const s = new THREE.Sprite(smat);
      s.position.set(x, y, z);
      s.scale.setScalar(0.55);
      group.add(s);
      out.push(smat as unknown as BeamMat);
      disposables.push(smat);
    };

    const head: BeamMat[] = [];
    const tail: BeamMat[] = [];
    const fog: BeamMat[] = [];
    HEADLIGHTS.forEach((p) => beamPair(p, BEAM, HEAD_GLOW, 1, head));
    TAIL_POSITIONS.forEach((p) => beamPair(p, TAIL, TAIL_COLOR, -1, tail));
    FOG_POSITIONS.forEach((p) => beamPair(p, FOG, FOG_COLOR, 1, fog));

    // Emissive lamp meshes — clone materials before mutating (GLB materials are shared).
    const headLamps: THREE.Mesh[] = [];
    const tailLamps: THREE.Mesh[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const n = mesh.name;
      const hit = (names: string[]) => names.some((p) => n.startsWith(p));
      if (hit(HEAD_NAMES)) {
        mesh.material = (mesh.material as THREE.Material).clone();
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissive = new THREE.Color(HEAD_GLOW);
        mat.emissiveIntensity = 0; // start dark; frame ramps it up
        headLamps.push(mesh);
        disposables.push(mat);
      } else if (hit(TAIL_NAMES)) {
        mesh.material = (mesh.material as THREE.Material).clone();
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissive = new THREE.Color(TAIL_COLOR);
        mat.emissiveIntensity = 0;
        tailLamps.push(mesh);
        disposables.push(mat);
      }
    });

    scene.add(group);
    lights.current = { group, head, tail, fog, headLamps, tailLamps, disposables };

    if (import.meta.env.DEV && (headLamps.length === 0 || tailLamps.length === 0)) {
      console.warn("[lights] lamp meshes:", { head: headLamps.length, tail: tailLamps.length });
    }

    return () => {
      scene.remove(group);
      disposables.forEach((d) => d.dispose());
      lights.current = null;
    };
  }, [scene]);

  useFrame((_, delta) => {
    const L = lights.current;
    if (!L) return;
    const s = getState();
    const k = Math.min(1, delta * 4);
    // Auto resolves against the environment (fog/night → head+tail on; fog → fog lamps).
    const headOn = effectiveHeadlights(s) === "on";
    const tailOn = effectiveTaillights(s) === "on";
    const fogOn = effectiveFoglights(s) && headOn; // fog only casts when headlights are on

    const ramp = (mats: BeamMat[], on: boolean) => {
      for (const m of mats) m.opacity += ((on ? m.userData.max : 0) - m.opacity) * k;
    };
    ramp(L.head, headOn);
    ramp(L.tail, tailOn);
    ramp(L.fog, fogOn);

    const emit = (lamps: THREE.Mesh[], on: boolean, max: number) => {
      for (const lamp of lamps) {
        const mat = lamp.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity += ((on ? max : 0) - mat.emissiveIntensity) * k;
      }
    };
    emit(L.headLamps, headOn, HEAD_EMISSIVE);
    emit(L.tailLamps, tailOn, TAIL_EMISSIVE);
  });
}
