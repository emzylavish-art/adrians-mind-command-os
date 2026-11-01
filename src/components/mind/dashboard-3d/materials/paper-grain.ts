import * as THREE from "three";

/** Hard cap — prevents attacker/odd inputs from OOM via size^2 RGBA buffers. */
export const PAPER_GRAIN_MIN_SIZE = 8;
export const PAPER_GRAIN_MAX_SIZE = 2048;

/** Deterministic 0..1 hash (no DOM). */
export function paperHash(n: number, seed = 1): number {
  const x = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Sanitize texture edge length for procedural paper grain.
 * Rejects NaN/Infinity/negatives; clamps to [PAPER_GRAIN_MIN_SIZE, PAPER_GRAIN_MAX_SIZE].
 */
export function sanitizePaperGrainSize(size: number, fallback = 256): number {
  const fb = Number.isFinite(fallback)
    ? Math.min(PAPER_GRAIN_MAX_SIZE, Math.max(PAPER_GRAIN_MIN_SIZE, Math.floor(fallback)))
    : 256;
  if (!Number.isFinite(size)) return fb;
  const n = Math.floor(size);
  if (n < PAPER_GRAIN_MIN_SIZE) return PAPER_GRAIN_MIN_SIZE;
  if (n > PAPER_GRAIN_MAX_SIZE) return PAPER_GRAIN_MAX_SIZE;
  return n;
}

export function sanitizeFinite(value: number, fallback: number, min?: number, max?: number): number {
  let v = Number.isFinite(value) ? value : fallback;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}

/** Pure RGBA buffer of paper grain (procedural, no external image). */
export function makePaperGrainRGBA(
  size: number,
  seed = 1,
  strength = 18,
): Uint8ClampedArray {
  const s = sanitizePaperGrainSize(size);
  const str = sanitizeFinite(strength, 18, 0, 64);
  const seedN = Number.isFinite(seed) ? seed : 1;
  const data = new Uint8ClampedArray(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const n = (paperHash(i * 0.17 + x + y * s, seedN) - 0.5) * str;
      const base = 18 + paperHash(i + 3, seedN + 2) * 22;
      const v = Math.min(255, Math.max(0, base + n));
      data[i] = v;
      data[i + 1] = v * 0.98;
      data[i + 2] = Math.min(255, v * 1.05 + 4);
      data[i + 3] = 255;
    }
  }
  return data;
}

export type PaperGrainTextureOptions = {
  size?: number;
  seed?: number;
  strength?: number;
};

/** CanvasTexture paper grain for Three.js materials. */
export function createPaperGrainTexture(
  opts: PaperGrainTextureOptions = {},
): THREE.DataTexture {
  const size = sanitizePaperGrainSize(opts.size ?? 256);
  const data = makePaperGrainRGBA(size, opts.seed ?? 1, opts.strength ?? 18);
  // CRITICAL: DataTexture dims must match buffer edge (sanitized), never raw opts.size
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
