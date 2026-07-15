import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getState } from "../state/vehicleState";
import { effectiveClimate } from "../state/autoResolve";
import redWindUrl from "../../assets/wind/Red_wind.png";
import coolWindUrl from "../../assets/wind/Cool_wind.png";

// Climate cabin glow + wind washes. Two independent controls:
//   • Climate (AC/Heat) drives the cabin GLOW — heat = warm orange-red, A/C = blue,
//     `auto`/`off` = no glow.
//   • Fan drives the WIND washes toward the seats — warm (red) when heating,
//     cool/white otherwise; hidden when the fan is off.
// Only visible in cabin view (physically inside the cabin; roof/body occlude them).
const ZONE = { cx: 0, cz: -0.3, y: 0.84, w: 1.9, l: 3.4 };
const HEAT_COLOR = 0xff9a9a; // light orange-red
const AC_COLOR = 0x4fa0e8;
const TINT_MAX = 0.43; // light coral/blue wash — dialed to ~60% for a subtler glow
const GLOW_MAX = 0.28;
const WIND_MAX = 0.6;
const WIND_EMITTERS = [
  { x: 0.4, z: 0.45, w: 0.62, l: 1.25 }, // over driver seat
  { x: -0.4, z: 0.45, w: 0.62, l: 1.25 }, // over passenger seat
  { x: 0.0, z: -0.3, w: 0.46, l: 1.05 }, // console → rear bench
];

type BasicMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

/**
 * Two warm sources — front (windshield ∩ dashboard) and rear (backlight ∩ interior) —
 * each a soft radial bloom whose tails overlap so the whole cabin stays lit but glows
 * brightest where the glass meets the interior. Canvas height maps to the car's length;
 * low y = front. No hard edges (each bloom fades to zero alpha).
 */
function cabinGlowTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 512;
  const ctx = cv.getContext("2d")!;
  ctx.globalCompositeOperation = "lighter"; // blooms accumulate where they overlap

  const bloom = (cy: number, radius: number, peak: number) => {
    const g = ctx.createRadialGradient(128, cy, 6, 128, cy, radius);
    g.addColorStop(0.0, `rgba(255,255,255,${peak})`);
    g.addColorStop(0.5, `rgba(255,255,255,${peak * 0.35})`);
    g.addColorStop(1.0, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 512);
  };

  bloom(70, 260, 0.95); // front — windshield meets dashboard (brightest)
  bloom(452, 260, 0.72); // rear — backlight meets the interior
  return new THREE.CanvasTexture(cv);
}

interface Climate {
  group: THREE.Group;
  tint: BasicMesh; // deep saturating wash (NormalBlending)
  glow: BasicMesh; // luminous core (AdditiveBlending)
  wind: BasicMesh[];
  windMode: "heat" | "cool"; // which wind texture is currently mapped
}

export function useClimateEffects(scene: THREE.Object3D) {
  const climate = useRef<Climate | null>(null);
  const windTex = useRef<{ heat: THREE.Texture; ac: THREE.Texture } | null>(null);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    const heat = loader.load(redWindUrl);
    const ac = loader.load(coolWindUrl);
    windTex.current = { heat, ac };

    const group = new THREE.Group();
    group.userData.isFx = true; // excluded from the model bounding box (camera centring)
    const tex = cabinGlowTexture();

    const layer = (blending: THREE.Blending, yOff: number, scale: number): BasicMesh => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(ZONE.w * scale, ZONE.l * scale),
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0,
          blending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      ) as BasicMesh;
      m.rotation.x = -Math.PI / 2;
      m.position.set(ZONE.cx, ZONE.y + yOff, ZONE.cz);
      group.add(m);
      return m;
    };

    const wind: BasicMesh[] = WIND_EMITTERS.map((e) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(e.w, e.l),
        new THREE.MeshBasicMaterial({
          map: heat,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      ) as BasicMesh;
      m.rotation.x = -Math.PI / 2;
      m.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI); // dense end faces the vent
      m.position.set(e.x, ZONE.y + 0.08, e.z);
      group.add(m);
      return m;
    });

    const tint = layer(THREE.NormalBlending, 0, 1.0);
    const glow = layer(THREE.AdditiveBlending, 0.05, 0.82);
    climate.current = { group, tint, glow, wind, windMode: "heat" }; // meshes start on the red map
    scene.add(group);

    return () => {
      scene.remove(group);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose();
      });
      tex.dispose();
      heat.dispose();
      ac.dispose();
      climate.current = null;
      windTex.current = null;
    };
  }, [scene]);

  useFrame((_, delta) => {
    const c = climate.current;
    if (!c) return;
    const dt = Math.min(delta, 0.05);
    const s = getState();
    const mode = effectiveClimate(s); // 'off' | 'ac' | 'heat' (auto resolved vs. env temp)
    const k = Math.min(1, dt * 4);
    const breathe = 0.92 + 0.08 * Math.sin(performance.now() * 0.0013);

    // Cabin glow — AC/Heat only. heat = warm orange-red, A/C = blue.
    const glowOn = mode === "heat" || mode === "ac";
    const col = mode === "heat" ? HEAT_COLOR : AC_COLOR;
    c.tint.material.color.setHex(col);
    c.glow.material.color.setHex(col);
    c.tint.material.opacity += ((glowOn ? TINT_MAX * breathe : 0) - c.tint.material.opacity) * k;
    c.glow.material.opacity += ((glowOn ? GLOW_MAX * breathe : 0) - c.glow.material.opacity) * k;

    // Wind washes — driven by the Fan. Warm (red) when heating, cool/white otherwise.
    const windMode: "heat" | "cool" = mode === "heat" ? "heat" : "cool";
    if (c.windMode !== windMode && windTex.current) {
      c.windMode = windMode;
      const t = windMode === "heat" ? windTex.current.heat : windTex.current.ac;
      c.wind.forEach((m) => {
        m.material.map = t;
        m.material.needsUpdate = true;
      });
    }
    c.wind.forEach((m) => {
      m.material.opacity += ((s.fan ? WIND_MAX : 0) - m.material.opacity) * k;
    });
  });
}
