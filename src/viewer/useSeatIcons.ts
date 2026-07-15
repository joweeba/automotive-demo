import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getState } from "../state/vehicleState";
import type { SeatId } from "../state/vehicleState";
import {
  SEAT_ARROW_PATHS,
  SEAT_HEAT_HOT,
  SEAT_HEAT_OFF,
  SEAT_HEAT_OFF_OPACITY,
} from "../seatArrowPaths";

// Seat-heat sprites floating above each seat. Omnipresent (the reference's
// choice); depth-tested, so the roof/body naturally hide them outside cabin view.
const SEAT_ICON_HEIGHT = 1.15;
const SEATS: { id: SeatId; mesh: string }[] = [
  { id: "driver", mesh: "front-seat" },
  { id: "passenger", mesh: "front-seat-passenger" },
  { id: "rear", mesh: "rear-seat" },
];

/** Canvas tile drawing the three arrows: first `level` hot, the rest inert. */
function seatIconTexture(level: number): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 144;
  const ctx = cv.getContext("2d")!;
  const S = 144 / 18;
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.translate(2.5, -1.7); // centre the arrow group in the tile
  SEAT_ARROW_PATHS.forEach((d, i) => {
    const hot = i < level;
    ctx.fillStyle = hot ? SEAT_HEAT_HOT : SEAT_HEAT_OFF;
    ctx.globalAlpha = hot ? 1 : SEAT_HEAT_OFF_OPACITY;
    ctx.fill(new Path2D(d));
  });
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  return t;
}

interface SeatSprite {
  sprite: THREE.Sprite;
  level: number;
}

export function useSeatIcons(scene: THREE.Object3D) {
  const sprites = useRef<Partial<Record<SeatId, SeatSprite>>>({});

  useEffect(() => {
    const built: Partial<Record<SeatId, SeatSprite>> = {};
    for (const { id, mesh: meshName } of SEATS) {
      const mesh = scene.getObjectByName(meshName);
      if (!mesh) continue;
      const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      const level = getState().seatHeat[id];
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: seatIconTexture(level), transparent: true, depthWrite: false }),
      );
      sprite.position.set(c.x, SEAT_ICON_HEIGHT, c.z);
      sprite.scale.setScalar(0.3);
      sprite.userData.isFx = true; // excluded from the model bounding box (camera centring)
      scene.add(sprite);
      built[id] = { sprite, level };
    }
    sprites.current = built;

    if (import.meta.env.DEV && Object.keys(built).length < SEATS.length) {
      console.warn("[seatIcons] some seat meshes not found:", Object.keys(built));
    }

    return () => {
      for (const entry of Object.values(built)) {
        if (!entry) continue;
        scene.remove(entry.sprite);
        entry.sprite.material.map?.dispose();
        entry.sprite.material.dispose();
      }
      sprites.current = {};
    };
  }, [scene]);

  useFrame(() => {
    const seatHeat = getState().seatHeat;
    for (const { id } of SEATS) {
      const entry = sprites.current[id];
      if (!entry) continue;
      const level = seatHeat[id];
      if (level === entry.level) continue;
      entry.level = level;
      entry.sprite.material.map?.dispose();
      entry.sprite.material.map = seatIconTexture(level);
      entry.sprite.material.needsUpdate = true;
    }
  });
}
