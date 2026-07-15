import { useThree, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { VIEWS, type ViewId, type Spherical } from "./views";

// Initial orbit target before the model reports its bounding-box centre.
const DEFAULT_CENTER = new THREE.Vector3(0, 0.7, 0);

/**
 * Locked camera presets with a gentle free orbit, ported from the reference
 * viewer. The camera damps toward the selected preset (and the model centre)
 * every frame with `x += (target - x) * (1 - 0.0001^dt)`; drag orbits, wheel zooms.
 */
export function CameraRig({
  view,
  center,
  padRight = 0,
  zoom = 1,
}: {
  view: ViewId;
  center?: THREE.Vector3;
  /** Width (px) of the floating panel the full-bleed canvas renders behind; the
   *  frustum is sheared left by half of it so the car stays composed in the
   *  visible area instead of recentering under the panel. */
  padRight?: number;
  /** Multiplier on the orbit radius — >1 pulls the camera back (e.g. to see the
   *  whole car when both panels are open). */
  zoom?: number;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  // Off-axis shear: keep the subject centred in the viewport area left of the panel.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (padRight > 0) {
      cam.setViewOffset(size.width, size.height, padRight / 2, 0, size.width, size.height);
      cam.updateProjectionMatrix();
    }
    return () => {
      cam.clearViewOffset();
      cam.updateProjectionMatrix();
    };
  }, [camera, size.width, size.height, padRight]);

  const sph = useRef<Spherical>({ ...VIEWS[view] });
  const sphTarget = useRef<Spherical>({ ...VIEWS[view] });
  const c = useRef(DEFAULT_CENTER.clone());
  const cTarget = useRef((center ?? DEFAULT_CENTER).clone());
  const zoomRef = useRef(zoom);

  // Snap the orbit target to the selected preset when the view changes (applying
  // the current zoom factor to the radius).
  useEffect(() => {
    Object.assign(sphTarget.current, VIEWS[view]);
    sphTarget.current.r *= zoomRef.current;
  }, [view]);

  // Rescale the target radius when the zoom factor changes, preserving the current
  // orbit angle and any manual wheel-zoom (damping eases the camera out/in).
  useEffect(() => {
    const prev = zoomRef.current || 1;
    sphTarget.current.r *= zoom / prev;
    zoomRef.current = zoom;
  }, [zoom]);

  // Track the model's real centre once it loads.
  useEffect(() => {
    if (center) cTarget.current.copy(center);
  }, [center]);

  // Drag-orbit + wheel-zoom on the canvas, with the reference's exact tuning.
  useEffect(() => {
    const el = gl.domElement;
    const onPointerDown = (e: PointerEvent) => {
      const sx = e.clientX;
      const sy = e.clientY;
      const s0 = { ...sphTarget.current };
      const move = (ev: PointerEvent) => {
        sphTarget.current.theta = s0.theta - (ev.clientX - sx) * 0.006;
        sphTarget.current.phi = Math.min(
          Math.PI - 0.15,
          Math.max(0.1, s0.phi - (ev.clientY - sy) * 0.006),
        );
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      sphTarget.current.r = Math.min(
        20,
        Math.max(1.1, sphTarget.current.r * (1 + e.deltaY * 0.0012)),
      );
    };
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("wheel", onWheel);
    };
  }, [gl]);

  useFrame((_, dt) => {
    const k = 1 - Math.pow(0.0001, dt);
    const s = sph.current;
    const st = sphTarget.current;
    s.r += (st.r - s.r) * k;
    s.theta += (st.theta - s.theta) * k;
    s.phi += (st.phi - s.phi) * k;
    c.current.lerp(cTarget.current, k);
    camera.position.set(
      c.current.x + s.r * Math.sin(s.phi) * Math.sin(s.theta),
      c.current.y + s.r * Math.cos(s.phi),
      c.current.z + s.r * Math.sin(s.phi) * Math.cos(s.theta),
    );
    camera.lookAt(c.current);
  });

  return null;
}
