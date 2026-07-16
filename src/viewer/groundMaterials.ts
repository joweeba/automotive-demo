import * as THREE from "three";
import type { GroundId } from "../state/vehicleState";

// ---------------------------------------------------------------------------
// Procedural ground materials. Every surface's albedo / roughness / normal maps
// are generated on a <canvas> (no external texture files to ship or fetch), and
// each carries a set of MeshReflectorMaterial params tuned for how mirror-like the
// surface should be: marble is a polished showroom floor that reflects the whole
// car; dirt barely reflects at all. Results are cached per id so switching back
// and forth is instant. Pure THREE, no React.
// ---------------------------------------------------------------------------

const SIZE = 1024;
// Feature scale relative to the original 512px design, so speck/pebble/vein counts
// and sizes track the resolution (more, finer detail) instead of just upscaling.
const S = SIZE / 512;

/** Deterministic PRNG (mulberry32) — stable textures per material across reloads. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** One octave of tiling value noise sampled to a `size`² Float array in [0,1]. */
function valueNoise(size: number, cells: number, rand: () => number): Float32Array {
  const g = cells;
  const grid = new Float32Array((g + 1) * (g + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  // Wrap the last row/col back to the first so the field tiles seamlessly.
  for (let i = 0; i <= g; i++) {
    grid[i * (g + 1) + g] = grid[i * (g + 1)];
    grid[g * (g + 1) + i] = grid[i];
  }
  const out = new Float32Array(size * size);
  const step = size / g;
  for (let y = 0; y < size; y++) {
    const gy = y / step;
    const y0 = Math.floor(gy);
    const fy = smooth(gy - y0);
    for (let x = 0; x < size; x++) {
      const gx = x / step;
      const x0 = Math.floor(gx);
      const fx = smooth(gx - x0);
      const a = grid[y0 * (g + 1) + x0];
      const b = grid[y0 * (g + 1) + x0 + 1];
      const c = grid[(y0 + 1) * (g + 1) + x0];
      const d = grid[(y0 + 1) * (g + 1) + x0 + 1];
      out[y * size + x] = a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
    }
  }
  return out;
}

/** Fractal (summed octaves) tiling noise in [0,1]. */
function fractal(size: number, cells: number, octaves: number, persistence: number, seed: number) {
  const rand = mulberry32(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const layer = valueNoise(size, cells * 2 ** o, rand);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    total += amp;
    amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement("canvas");
  cv.width = cv.height = SIZE;
  return [cv, cv.getContext("2d")!];
}

/** Grayscale canvas from a height field (for overlaying detail onto a base color). */
function noiseCanvas(field: Float32Array, lo = 0, hi = 1): HTMLCanvasElement {
  const [cv, ctx] = makeCanvas();
  const img = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < field.length; i++) {
    const v = Math.round((lo + (hi - lo) * field[i]) * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Tangent-space normal map from a tiling height field, via central differences. */
function normalFromHeight(field: Float32Array, strength: number): HTMLCanvasElement {
  const [cv, ctx] = makeCanvas();
  const img = ctx.createImageData(SIZE, SIZE);
  const at = (x: number, y: number) =>
    field[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const p = (y * SIZE + x) * 4;
      img.data[p] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[p + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[p + 2] = (1 / len) * 0.5 * 255 + 128;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function texture(cv: HTMLCanvasElement, repeat: number, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 16;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

/** Paint a seamless grid of grout seams onto a canvas — for a tiled floor. The boundary
 *  seam is split into two half-lines so it completes cleanly across the repeat wrap. */
function drawTileGrid(ctx: CanvasRenderingContext2D, tiles: number, groutPx: number, style: string) {
  const tile = SIZE / tiles;
  const half = groutPx / 2;
  ctx.fillStyle = style;
  for (let i = 1; i < tiles; i++) {
    const p = i * tile;
    ctx.fillRect(p - half, 0, groutPx, SIZE); // vertical seam
    ctx.fillRect(0, p - half, SIZE, groutPx); // horizontal seam
  }
  ctx.fillRect(0, 0, half, SIZE);
  ctx.fillRect(SIZE - half, 0, half, SIZE);
  ctx.fillRect(0, 0, SIZE, half);
  ctx.fillRect(0, SIZE - half, SIZE, half);
}

/** Carve grout grooves (lower height) into a tiling height field at the tile seams. */
function stampTileGrooves(field: Float32Array, tiles: number, groutPx: number, depth: number) {
  const tile = SIZE / tiles;
  const half = groutPx / 2;
  const onSeam = (c: number) => {
    const m = ((c % tile) + tile) % tile;
    return Math.min(m, tile - m) < half;
  };
  for (let y = 0; y < SIZE; y++) {
    const sy = onSeam(y);
    for (let x = 0; x < SIZE; x++) {
      if (sy || onSeam(x)) field[y * SIZE + x] = Math.max(0, field[y * SIZE + x] - depth);
    }
  }
}

// --- per-material builders --------------------------------------------------

export interface GroundResources {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
  repeat: number;
  normalScale: number;
  /** MeshReflectorMaterial tuning — how mirror-like this surface is. */
  reflector: {
    roughness: number;
    metalness: number;
    mirror: number; // 0 = matte (texture only) … 1 = pure mirror
    mixStrength: number; // reflection contribution
    mixBlur: number;
    blur: [number, number];
    mixContrast: number;
    depthScale: number;
  };
}

function build(id: GroundId): GroundResources {
  const [base, ctx] = makeCanvas();

  if (id === "asphalt") {
    ctx.fillStyle = "#3a3d43";
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Fine aggregate grain modulating the base.
    const grain = fractal(SIZE, 48, 4, 0.55, 12);
    ctx.globalAlpha = 0.6;
    ctx.globalCompositeOperation = "overlay";
    ctx.drawImage(noiseCanvas(grain, 0.2, 0.8), 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    // Scattered light aggregate specks.
    const rand = mulberry32(99);
    for (let i = 0; i < 2600 * S * S; i++) {
      const v = 90 + rand() * 90;
      ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + rand() * 0.4})`;
      ctx.fillRect(rand() * SIZE, rand() * SIZE, (1 + rand() * 1.5) * S, (1 + rand() * 1.5) * S);
    }
    const height = fractal(SIZE, 64, 4, 0.5, 7);
    return {
      map: texture(base, 14, true),
      roughnessMap: texture(noiseCanvas(fractal(SIZE, 24, 3, 0.5, 3), 0.72, 0.95), 14, false),
      normalMap: texture(normalFromHeight(height, 2.2 * S), 14, false),
      repeat: 14,
      normalScale: 0.6,
      reflector: {
        roughness: 0.82,
        metalness: 0.1,
        mirror: 0.32,
        mixStrength: 0.6,
        mixBlur: 3.5,
        blur: [400, 120],
        mixContrast: 1.0,
        depthScale: 1.1,
      },
    };
  }

  if (id === "dirt") {
    ctx.fillStyle = "#5c4530";
    ctx.fillRect(0, 0, SIZE, SIZE);
    const mottle = fractal(SIZE, 10, 5, 0.6, 21);
    ctx.globalAlpha = 0.85;
    ctx.globalCompositeOperation = "overlay";
    ctx.drawImage(noiseCanvas(mottle, 0.1, 0.95), 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    // Darker earth patches + small pebbles.
    const rand = mulberry32(43);
    for (let i = 0; i < 60 * S * S; i++) {
      ctx.fillStyle = `rgba(40,28,18,${0.05 + rand() * 0.12})`;
      const r = (20 + rand() * 70) * S;
      ctx.beginPath();
      ctx.arc(rand() * SIZE, rand() * SIZE, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 900 * S * S; i++) {
      const v = 70 + rand() * 70;
      ctx.fillStyle = `rgba(${v},${v * 0.8},${v * 0.6},${0.3 + rand() * 0.4})`;
      ctx.beginPath();
      ctx.arc(rand() * SIZE, rand() * SIZE, (0.8 + rand() * 2.2) * S, 0, Math.PI * 2);
      ctx.fill();
    }
    const height = fractal(SIZE, 18, 5, 0.6, 5);
    return {
      map: texture(base, 9, true),
      roughnessMap: texture(noiseCanvas(fractal(SIZE, 14, 3, 0.5, 9), 0.88, 1.0), 9, false),
      normalMap: texture(normalFromHeight(height, 4.5 * S), 9, false),
      repeat: 9,
      normalScale: 1.2,
      reflector: {
        roughness: 0.97,
        metalness: 0.0,
        mirror: 0.05,
        mixStrength: 0.15,
        mixBlur: 6,
        blur: [700, 350],
        mixContrast: 1.0,
        depthScale: 0.5,
      },
    };
  }

  if (id === "marble") {
    ctx.fillStyle = "#eceae4";
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Very soft cloudiness in the stone.
    const cloud = fractal(SIZE, 6, 4, 0.55, 71);
    ctx.globalAlpha = 0.25;
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(noiseCanvas(cloud, 0.75, 1.0), 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    // Grey veins — branching quadratic strokes.
    const rand = mulberry32(31);
    const vein = (x0: number, y0: number, len: number, w: number, shade: number) => {
      let x = x0;
      let y = y0;
      let ang = rand() * Math.PI * 2;
      ctx.strokeStyle = `rgba(${shade},${shade},${shade + 6},0.5)`;
      ctx.lineWidth = w * S;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < len; s++) {
        ang += (rand() - 0.5) * 0.5;
        x += Math.cos(ang) * 6 * S;
        y += Math.sin(ang) * 6 * S;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    for (let i = 0; i < 10 * S * S; i++) vein(rand() * SIZE, rand() * SIZE, 30 + rand() * 40, 1 + rand() * 3, 120 + rand() * 40);
    for (let i = 0; i < 22 * S * S; i++) vein(rand() * SIZE, rand() * SIZE, 15 + rand() * 25, 0.5 + rand() * 1, 150 + rand() * 40);

    // Tiled floor: a grid of square marble tiles with grout seams. Drawn after the veins
    // (tiles are cut, so veins stop at the seam); the seams are made rougher (they don't
    // mirror like the polished stone) and carved into the height for a subtle bevel.
    const TILE_REPEAT = 5; // canvas repeats across the plane → TILE_REPEAT*TILES tiles
    const TILES = 4; // tiles per canvas axis
    const GROUT = 6 * S;
    drawTileGrid(ctx, TILES, GROUT, "#cfd2d9"); // light-grey grout
    drawTileGrid(ctx, TILES, 1.5 * S, "rgba(150,153,161,0.55)"); // a thin darker inset for depth

    const roughCv = noiseCanvas(fractal(SIZE, 6, 2, 0.5, 2), 0.06, 0.16);
    drawTileGrid(roughCv.getContext("2d")!, TILES, GROUT, "rgb(150,150,150)"); // matte grout

    const height = fractal(SIZE, 8, 3, 0.5, 4);
    stampTileGrooves(height, TILES, GROUT, 0.5);
    return {
      map: texture(base, TILE_REPEAT, true),
      roughnessMap: texture(roughCv, TILE_REPEAT, false),
      normalMap: texture(normalFromHeight(height, 1.0 * S), TILE_REPEAT, false),
      repeat: TILE_REPEAT,
      normalScale: 0.35,
      reflector: {
        roughness: 0.1,
        metalness: 0.2,
        mirror: 0.72,
        mixStrength: 1.1,
        mixBlur: 1,
        blur: [120, 60],
        mixContrast: 1.1,
        depthScale: 1.2,
      },
    };
  }

  // concrete
  ctx.fillStyle = "#8f8f8c";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const blotch = fractal(SIZE, 8, 5, 0.55, 51);
  ctx.globalAlpha = 0.5;
  ctx.globalCompositeOperation = "overlay";
  ctx.drawImage(noiseCanvas(blotch, 0.3, 0.85), 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  // Faint pores + a couple of hairline cracks.
  const rand = mulberry32(63);
  for (let i = 0; i < 1400 * S * S; i++) {
    ctx.fillStyle = `rgba(60,60,60,${0.05 + rand() * 0.12})`;
    ctx.beginPath();
    ctx.arc(rand() * SIZE, rand() * SIZE, (0.5 + rand() * 1.2) * S, 0, Math.PI * 2);
    ctx.fill();
  }
  const height = fractal(SIZE, 20, 4, 0.5, 8);
  return {
    map: texture(base, 8, true),
    roughnessMap: texture(noiseCanvas(fractal(SIZE, 12, 3, 0.5, 6), 0.5, 0.72), 8, false),
    normalMap: texture(normalFromHeight(height, 1.4 * S), 8, false),
    repeat: 8,
    normalScale: 0.35,
    reflector: {
      roughness: 0.58,
      metalness: 0.1,
      mirror: 0.42,
      mixStrength: 0.7,
      mixBlur: 3,
      blur: [300, 120],
      mixContrast: 1.0,
      depthScale: 1.0,
    },
  };
}

const cache = new Map<GroundId, GroundResources>();

export function getGroundResources(id: GroundId): GroundResources {
  let r = cache.get(id);
  if (!r) {
    r = build(id);
    cache.set(id, r);
  }
  return r;
}
