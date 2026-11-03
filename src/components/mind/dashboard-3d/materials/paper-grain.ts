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

/** Idle constellation pigment — used when color inputs are empty/invalid (not bright white). */
export const PAINTER_IDLE_RGB: [number, number, number] = [0.36, 0.42, 0.55];

export type SanitizePainterColorResult = {
  color: THREE.Color;
  ok: boolean;
  reason: string | null;
};

/**
 * HACKER (c13): Three.Color.set("") / unknown CSS names coerce to white (1,1,1) with only a
 * console warning — bot stars flash bright-white on bad HEALTH_COLOR lookups instead of idle.
 * Reject empty/unknown strings and non-finite components; never silent.
 */
export function sanitizePainterColor(
  color: unknown,
  fallbackRgb: readonly [number, number, number] = PAINTER_IDLE_RGB,
): SanitizePainterColorResult {
  const fb = new THREE.Color(fallbackRgb[0], fallbackRgb[1], fallbackRgb[2]);
  if (color == null) return { color: fb.clone(), ok: false, reason: "color-null" };
  if (typeof color === "number") {
    if (!Number.isFinite(color)) return { color: fb.clone(), ok: false, reason: "color-nan-number" };
    return { color: new THREE.Color(color), ok: true, reason: null };
  }
  if (color instanceof THREE.Color) {
    if (Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b)) {
      return { color: color.clone(), ok: true, reason: null };
    }
    return { color: fb.clone(), ok: false, reason: "color-nan-components" };
  }
  if (Array.isArray(color) && color.length >= 3) {
    const r = Number(color[0]);
    const g = Number(color[1]);
    const b = Number(color[2]);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return { color: new THREE.Color(r, g, b), ok: true, reason: null };
    }
    return { color: fb.clone(), ok: false, reason: "color-array-nan" };
  }
  if (typeof color === "string") {
    const s = color.trim();
    if (!s) return { color: fb.clone(), ok: false, reason: "color-empty" };
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) {
      return { color: new THREE.Color(s), ok: true, reason: null };
    }
    if (/^0x[0-9a-fA-F]+$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return { color: fb.clone(), ok: false, reason: "color-bad-hex" };
      return { color: new THREE.Color(n), ok: true, reason: null };
    }
    const names = (THREE.Color as unknown as { NAMES?: Record<string, number> }).NAMES;
    const key = s.toLowerCase();
    if (names && Object.prototype.hasOwnProperty.call(names, key)) {
      return { color: new THREE.Color(key), ok: true, reason: null };
    }
    // Health tone strings are handled by callers with HEALTH_RGB; here treat as unknown
    return { color: fb.clone(), ok: false, reason: `color-unknown:${s.slice(0, 32)}` };
  }
  return { color: fb.clone(), ok: false, reason: "color-type" };
}

