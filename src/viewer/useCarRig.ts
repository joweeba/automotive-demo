import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getState } from "../state/vehicleState";
import { effectiveWiper } from "../state/autoResolve";

// Rig constants — ported verbatim from reference/sedan_demo_viewer.html CONFIG.
const HOOD_DEG = -40; // frunk (front hood) open angle
const TRUNK_DEG = 60; // rear trunk open angle
const WIPER_SWEEP_DEG = 55;
const WIPER_SPEED = 2.6;

const AX = new THREE.Vector3(1, 0, 0); // hood/trunk hinge axis
const WS_N = new THREE.Vector3(0, 0.902, 0.432).normalize(); // wiper (windshield-normal) axis
const deg = THREE.MathUtils.degToRad;

interface Pivots {
  hood: THREE.Object3D | null;
  trunk: THREE.Object3D | null;
  wiperL: THREE.Object3D | null;
  wiperR: THREE.Object3D | null;
}

/**
 * Drives the mechanical pivots (frunk/hood, trunk, wipers) from vehicle state,
 * read live each frame (no React re-renders). Frunk/trunk damp 0→1 toward their
 * open target with `x += (target - x) * (1 - 0.002^dt)`; wipers oscillate about
 * the windshield normal and park to the nearest half-cycle when off. Pivot nodes
 * have identity rest orientation, so `setFromAxisAngle` sets them outright — same
 * as the reference. Never rename the GLB nodes; behaviour binds by these names.
 */
export function useCarRig(scene: THREE.Object3D) {
  const pivots = useRef<Pivots>({ hood: null, trunk: null, wiperL: null, wiperR: null });
  const frunk = useRef(0);
  const trunk = useRef(0);
  const wiperPhase = useRef(0);

  useEffect(() => {
    const p: Pivots = {
      hood: scene.getObjectByName("PIVOT_hood") ?? null,
      trunk: scene.getObjectByName("PIVOT_trunk") ?? null,
      wiperL: scene.getObjectByName("PIVOT_wiper_L") ?? null,
      wiperR: scene.getObjectByName("PIVOT_wiper_R") ?? null,
    };
    pivots.current = p;
    if (import.meta.env.DEV && (!p.hood || !p.trunk || !p.wiperL || !p.wiperR)) {
      console.warn("[carRig] missing pivot nodes", {
        hood: !!p.hood,
        trunk: !!p.trunk,
        wiperL: !!p.wiperL,
        wiperR: !!p.wiperR,
      });
    }
  }, [scene]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const s = getState();
    const p = pivots.current;

    // Frunk / trunk — damp openness toward 0 or 1.
    const k = 1 - Math.pow(0.002, dt);
    frunk.current += ((s.frunk ? 1 : 0) - frunk.current) * k;
    trunk.current += ((s.trunk ? 1 : 0) - trunk.current) * k;
    if (p.hood) p.hood.quaternion.setFromAxisAngle(AX, deg(HOOD_DEG) * frunk.current);
    if (p.trunk) p.trunk.quaternion.setFromAxisAngle(AX, deg(TRUNK_DEG) * trunk.current);

    // Wipers — sweep while on; park to the nearest half-cycle when off.
    // Auto resolves against the weather (rain → on).
    if (effectiveWiper(s) === "on") {
      wiperPhase.current += dt * WIPER_SPEED;
    } else {
      const parked = Math.ceil(wiperPhase.current / Math.PI) * Math.PI;
      wiperPhase.current += (parked - wiperPhase.current) * Math.min(1, dt * 5);
    }
    const sweep = -deg(WIPER_SWEEP_DEG) * 0.5 * (1 - Math.cos(wiperPhase.current));
    if (p.wiperL) p.wiperL.quaternion.setFromAxisAngle(WS_N, sweep);
    if (p.wiperR) p.wiperR.quaternion.setFromAxisAngle(WS_N, sweep);
  });
}
