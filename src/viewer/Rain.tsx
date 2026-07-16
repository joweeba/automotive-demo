import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { getState } from "../state/vehicleState";
import { effectiveWiper } from "../state/autoResolve";

// Wind-driven rain, shown whenever the (resolved) windshield wiper is on. Two parts:
//   • streaks  — a dense cloud of GPU line segments falling under gravity, each
//     oriented along its velocity so a gusting crosswind slants the whole sheet.
//     Per-drop brightness varies so the sheet has depth instead of reading flat.
//   • splashes — flat ring ripples that bloom + fade on the ground where drops land
//     (an InstancedMesh, additive), which is most of what makes rain read as "real".
// Everything fades in/out with the wiper and is mirrored in the wet ground.

// --- streaks ---------------------------------------------------------------
const COUNT = 5200;
const TOP = 20;
const BOTTOM = -0.5;
const FIELD = 26; // x/z extent of the rain volume (centred on the car)
const FALL = 18; // base fall speed (m/s)
const STREAK_OPACITY = 0.5;
const BASE_COLOR = new THREE.Color(0.72, 0.8, 1.0);

// Gust model: a light base breeze plus a wandering gust that eases toward a new
// (gentle) random target periodically — so the slant drifts naturally.
const GUST_MAX = 6;
const GUST_MIN_INTERVAL = 1.6;
const GUST_MAX_INTERVAL = 4.5;

// --- splashes --------------------------------------------------------------
const RIPPLES = 150;
const RIPPLE_RADIUS = 15; // spread of splashes around the car
const RIPPLE_MAX = 0.34; // final ring radius (m)
const RIPPLE_BRIGHT = 0.46;

function rippleTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const ctx = cv.getContext("2d")!;
  // A soft bright ring, transparent in the middle and outside.
  const g = ctx.createRadialGradient(64, 64, 30, 64, 64, 62);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.72, "rgba(210,225,255,0.9)");
  g.addColorStop(1, "rgba(210,225,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(cv);
}

export function Rain() {
  const streaksRef = useRef<THREE.LineSegments>(null);
  const ripplesRef = useRef<THREE.InstancedMesh>(null);
  const opacity = useRef(0);

  // Per-drop head position + speed + brightness; endpoints derived each frame.
  const sim = useMemo(() => {
    const px = new Float32Array(COUNT);
    const py = new Float32Array(COUNT);
    const pz = new Float32Array(COUNT);
    const spd = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      px[i] = (Math.random() - 0.5) * FIELD;
      py[i] = BOTTOM + Math.random() * (TOP - BOTTOM);
      pz[i] = (Math.random() - 0.5) * FIELD;
      spd[i] = 0.7 + Math.random() * 0.6;
    }
    return { px, py, pz, spd };
  }, []);

  const streakGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 6), 3));
    // Per-drop brightness baked into vertex colors (both verts of a drop share it).
    const col = new Float32Array(COUNT * 6);
    for (let i = 0; i < COUNT; i++) {
      const b = 0.4 + Math.random() * 0.6;
      for (let v = 0; v < 2; v++) {
        col[i * 6 + v * 3] = BASE_COLOR.r * b;
        col[i * 6 + v * 3 + 1] = BASE_COLOR.g * b;
        col[i * 6 + v * 3 + 2] = BASE_COLOR.b * b;
      }
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, []);

  // Splash ripples: position + phase per instance.
  const ripples = useMemo(() => {
    const rx = new Float32Array(RIPPLES);
    const rz = new Float32Array(RIPPLES);
    const t = new Float32Array(RIPPLES);
    const dur = new Float32Array(RIPPLES);
    for (let i = 0; i < RIPPLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * RIPPLE_RADIUS;
      rx[i] = Math.cos(a) * r;
      rz[i] = Math.sin(a) * r;
      t[i] = Math.random();
      dur[i] = 0.5 + Math.random() * 0.7;
    }
    return { rx, rz, t, dur };
  }, []);

  const rippleGeo = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const rippleTex = useMemo(rippleTexture, []);

  const wind = useRef(new THREE.Vector2(2, -0.5));
  const windTarget = useRef(new THREE.Vector2(2, -0.5));
  const gustTimer = useRef(0);
  const mat4 = useMemo(() => new THREE.Matrix4(), []);
  const col = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    const streaks = streaksRef.current;
    const rip = ripplesRef.current;
    if (!streaks || !rip) return;
    const dt = Math.min(delta, 0.05);

    const on = effectiveWiper(getState()) === "on";
    opacity.current += ((on ? 1 : 0) - opacity.current) * Math.min(1, dt * 3);
    const o = opacity.current;
    const visible = o > 0.004;
    streaks.visible = visible;
    rip.visible = visible;
    (streaks.material as THREE.LineBasicMaterial).opacity = o * STREAK_OPACITY;
    if (!visible) return;

    // Evolve the gust (gentle wander around a light base breeze).
    gustTimer.current -= dt;
    if (gustTimer.current <= 0) {
      const ang = Math.random() * Math.PI * 2;
      const mag = 1 + Math.random() * GUST_MAX;
      windTarget.current.set(Math.cos(ang) * mag, Math.sin(ang) * mag);
      gustTimer.current = GUST_MIN_INTERVAL + Math.random() * (GUST_MAX_INTERVAL - GUST_MIN_INTERVAL);
    }
    wind.current.lerp(windTarget.current, Math.min(1, dt * 0.4));

    const { px, py, pz, spd } = sim;
    const wx = wind.current.x;
    const wz = wind.current.y;
    const pos = streakGeo.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const half = FIELD / 2;

    for (let i = 0; i < COUNT; i++) {
      const vy = -FALL * spd[i];
      px[i] += wx * dt;
      pz[i] += wz * dt;
      py[i] += vy * dt;
      if (py[i] < BOTTOM) {
        py[i] = TOP;
        px[i] = (Math.random() - 0.5) * FIELD;
        pz[i] = (Math.random() - 0.5) * FIELD;
      }
      if (px[i] > half) px[i] -= FIELD;
      else if (px[i] < -half) px[i] += FIELD;
      if (pz[i] > half) pz[i] -= FIELD;
      else if (pz[i] < -half) pz[i] += FIELD;

      const len = 0.45 + spd[i] * 0.5;
      const inv = len / Math.hypot(wx, vy, wz);
      const b = i * 6;
      arr[b] = px[i];
      arr[b + 1] = py[i];
      arr[b + 2] = pz[i];
      arr[b + 3] = px[i] - wx * inv;
      arr[b + 4] = py[i] - vy * inv;
      arr[b + 5] = pz[i] - wz * inv;
    }
    pos.needsUpdate = true;

    // Advance splash ripples: expand + fade, respawn at a new spot when done.
    const { rx, rz, t, dur } = ripples;
    for (let i = 0; i < RIPPLES; i++) {
      t[i] += dt / dur[i];
      if (t[i] >= 1) {
        t[i] = 0;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * RIPPLE_RADIUS;
        rx[i] = Math.cos(a) * r;
        rz[i] = Math.sin(a) * r;
        dur[i] = 0.5 + Math.random() * 0.7;
      }
      const p = t[i];
      const radius = 0.04 + p * RIPPLE_MAX;
      mat4.makeScale(radius, 1, radius);
      mat4.setPosition(rx[i], 0.02, rz[i]);
      rip.setMatrixAt(i, mat4);
      const fade = Math.sin(Math.min(1, p) * Math.PI); // rise then fall
      const c = fade * RIPPLE_BRIGHT * o;
      rip.setColorAt(i, col.setRGB(c, c * 1.05, c * 1.15));
    }
    rip.instanceMatrix.needsUpdate = true;
    if (rip.instanceColor) rip.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <lineSegments ref={streaksRef} geometry={streakGeo} frustumCulled={false} visible={false}>
        <lineBasicMaterial vertexColors transparent opacity={0} depthWrite={false} toneMapped={false} />
      </lineSegments>
      <instancedMesh
        ref={ripplesRef}
        args={[rippleGeo, undefined, RIPPLES]}
        frustumCulled={false}
        visible={false}
      >
        <meshBasicMaterial
          map={rippleTex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}
