// Camera presets — ported verbatim from reference/sedan_demo_viewer.html CONFIG.views.
// Spherical convention (see CameraRig): phi = polar angle from +Y, theta = azimuth in
// the XZ plane where theta=0 faces +Z (the FRONT of the car). r = orbit radius (metres).

export type ViewId = "threeq" | "top" | "side" | "cabin";

export interface Spherical {
  r: number;
  theta: number;
  phi: number;
}

export const VIEWS: Record<ViewId, Spherical> = {
  threeq: { r: 8.0, theta: 0.8, phi: 1.15 }, // front three-quarter
  top: { r: 8.5, theta: Math.PI, phi: 0.14 }, // top-down, front of car points up
  side: { r: 7.5, theta: Math.PI / 2, phi: 1.35 }, // profile
  cabin: { r: 3.2, theta: Math.PI, phi: 0.12 }, // tight top, front points up
};

// Display order / labels for the view switcher (matches Figma: Top / Cabin / Side / 3/4).
export const VIEW_ORDER: ViewId[] = ["top", "cabin", "side", "threeq"];

export const VIEW_LABELS: Record<ViewId, string> = {
  top: "Top",
  cabin: "Cabin",
  side: "Side",
  threeq: "3/4",
};
