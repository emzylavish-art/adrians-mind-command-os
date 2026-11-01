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


/**
 * Clamp procedural texture edge to both our hard cap and GL MAX_TEXTURE_SIZE.
 * If maxTextureSize is omitted/invalid, use a conservative mobile-safe default (1024)
 * rather than silently allocating PAPER_GRAIN_MAX_SIZE that some GPUs reject.
 */
export const GPU_SAFE_TEXTURE_DEFAULT = 1024;

export function clampTextureSizeToGpu(
  size: number,
  maxTextureSize?: number,
  fallback = 256,
): number {
  const base = sanitizePaperGrainSize(size, fallback);
  let gpuMax = GPU_SAFE_TEXTURE_DEFAULT;
  if (maxTextureSize != null && Number.isFinite(maxTextureSize) && maxTextureSize >= PAPER_GRAIN_MIN_SIZE) {
    gpuMax = Math.min(PAPER_GRAIN_MAX_SIZE, Math.floor(maxTextureSize));
  }
  return Math.min(base, gpuMax);
}

export function sanitizeFinite(value: number, fallback: number, min?: number, max?: number): number {
  let v = Number.isFinite(value) ? value : fallback;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}

/** Pure RGBA buffer of paper grain (procedural, no external image). */
/**
 * HACKER FIX (c3): shader time must stay bounded. Fragment shaders fall back to
 * mediump (fp16, max 65504, ~10-bit mantissa) on weak GPUs; an always-on wall
 * dashboard passes that in ~18h (and uTime*2.0 overflows at ~9h) -> Inf -> sin(Inf)
 * = NaN -> black/sparkling materials. Wrap into a short period instead.
 */
export const PAINTER_TIME_PERIOD = 600;

export function sanitizeShaderTime(timeSeconds: number, period = PAINTER_TIME_PERIOD): number {
  if (!Number.isFinite(timeSeconds)) return 0;
  const p = Number.isFinite(period) && period > 0 ? period : PAINTER_TIME_PERIOD;
  const w = ((timeSeconds % p) + p) % p;
  return w >= p ? 0 : w;
}

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

/** CanvasTexture paper grain for Three.js materials. */
export type PaperGrainTextureOptions = {
  size?: number;
  seed?: number;
  strength?: number;
  /** From gl.getParameter(gl.MAX_TEXTURE_SIZE); omit → mobile-safe 1024 cap */
  maxTextureSize?: number;
};

export function createPaperGrainTexture(
  opts: PaperGrainTextureOptions = {},
): THREE.DataTexture {
  const size = clampTextureSizeToGpu(opts.size ?? 256, opts.maxTextureSize);
  const data = makePaperGrainRGBA(size, opts.seed ?? 1, opts.strength ?? 18);
  // CRITICAL: DataTexture dims must match buffer edge (sanitized), never raw opts.size
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
