import * as THREE from "three";
import { sanitizeFinite, sanitizePainterColor, PAINTER_IDLE_RGB } from "./paper-grain.ts";

/** Soft ceiling when matte=0 (legacy HDR headroom that blows Light bloom). */
export const PAINTER_HDR_CEILING = 1.6;
/** Bloom-safe ceiling when matte=1 — Light UnrealBloom picks paint, not fireballs. */
export const PAINTER_BLOOM_SAFE_CEILING = 0.98;
/** Default matte for active stars (queue visual). */
export const PAINTER_MATTE_DEFAULT = 0.85;
/** Idle stars stay quieter under bloom. */
export const PAINTER_MATTE_IDLE = 0.95;

/**
 * Map idle/health → corona matte. Honest idle when health unknown → default matte
 * (never fabricate a bright corona).
 */
export function starMatteFromStatus(idle?: boolean, matte?: number): number {
  if (matte != null) return sanitizeFinite(matte, PAINTER_MATTE_DEFAULT, 0, 1);
  if (idle === true) return PAINTER_MATTE_IDLE;
  if (idle === false) return PAINTER_MATTE_DEFAULT;
  return PAINTER_MATTE_DEFAULT;
}

/**
 * Pure luminance soft-cap (mirrors shader bloomSafeClamp) — for unit tests.
 * matte 0 → allow up to PAINTER_HDR_CEILING; matte 1 → PAINTER_BLOOM_SAFE_CEILING.
 */
export function bloomSafeClampRgb(
  rgb: readonly [number, number, number],
  matte: number,
): [number, number, number] {
  const m = sanitizeFinite(matte, PAINTER_MATTE_DEFAULT, 0, 1);
  const lim = PAINTER_HDR_CEILING + (PAINTER_BLOOM_SAFE_CEILING - PAINTER_HDR_CEILING) * m;
  const r = Number.isFinite(rgb[0]) ? rgb[0] : 0;
  const g = Number.isFinite(rgb[1]) ? rgb[1] : 0;
  const b = Number.isFinite(rgb[2]) ? rgb[2] : 0;
  const maxC = Math.max(r, g, b, 0);
  if (maxC <= lim || maxC < 1e-8) {
    return [
      Math.min(Math.max(r, 0), lim),
      Math.min(Math.max(g, 0), lim),
      Math.min(Math.max(b, 0), lim),
    ];
  }
  const s = lim / maxC;
  return [r * s, g * s, b * s];
}

export type PainterOutputSafeFlags = {
  toneMapped: boolean;
  premultipliedAlpha: boolean;
  transparent: boolean;
};

/**
 * HACKER (c21):
 * - toneMapped:true on painted ShaderMaterials → sRGB/ACES washout of authored pigment
 * - premultipliedAlpha:false + transparent → dark fringes on watercolor edges
 * Apply once at material create; does not touch Light atmosphere/postfx.
 */
export function applyPainterOutputSafeFlags(
  mat: THREE.Material | null | undefined,
  opts: { transparent?: boolean; premultipliedAlpha?: boolean } = {},
): PainterOutputSafeFlags | null {
  if (!mat || (mat as { disposed?: boolean }).disposed) return null;
  const transparent = opts.transparent ?? ("transparent" in mat ? !!(mat as THREE.Material).transparent : true);
  const premul = opts.premultipliedAlpha ?? transparent;
  if ("toneMapped" in mat) (mat as THREE.Material & { toneMapped: boolean }).toneMapped = false;
  if ("transparent" in mat) (mat as THREE.Material).transparent = transparent;
  if ("premultipliedAlpha" in mat) {
    (mat as THREE.Material & { premultipliedAlpha: boolean }).premultipliedAlpha = premul;
  }
  mat.needsUpdate = true;
  const flags: PainterOutputSafeFlags = {
    toneMapped: false,
    premultipliedAlpha: premul,
    transparent,
  };
  (mat.userData as Record<string, unknown>).painterOutputSafe = flags;
  return flags;
}

/** Halo uniform clamp — never feed >1 into bloom-safe path (was 1.5 HDR). */
export function sanitizeStarHalo(halo: number, fallback = 0.55): number {
  return sanitizeFinite(halo, fallback, 0, 1);
}

/** Grain uniform clamp — HDR grain spikes blow bloom as badly as halo. */
export function sanitizeStarGrain(grain: number, fallback = 0.22): number {
  return sanitizeFinite(grain, fallback, 0, 1);
}


/** Max RGB channel after pigment map (watercolor paper, not LED). */
export const PAINTER_PIGMENT_MAX_CHANNEL = 0.72;
/** Pull pure primaries toward paper wash (0 = keep, 1 = full wash). */
export const PAINTER_PIGMENT_DESAT = 0.42;
/** Hard cap for uEmissive from pulse/setColor (Motion may send >1). */
export const PAINTER_EMISSIVE_MAX = 1.0;
/** Additive glow sprite color scale at matte=1 (quiet). */
export const PAINTER_GLOW_COLOR_SCALE_MATTE = 0.22;
/** Additive glow sprite color scale at matte=0. */
export const PAINTER_GLOW_COLOR_SCALE_OPEN = 0.48;

export type PainterPigmentResult = {
  color: THREE.Color;
  /** 0..1 saturation before map (for tests). */
  satIn: number;
  ok: boolean;
  reason: string | null;
};

/**
 * Map a status/UI hex into watercolor pigment — desaturate pure neon/primaries,
 * soft-cap channels. Honest idle when color is missing/NaN.
 */
export function painterPigmentFromStatusColor(
  input: THREE.ColorRepresentation | null | undefined,
  opts: { desat?: number; maxChannel?: number; fallback?: THREE.ColorRepresentation } = {},
): PainterPigmentResult {
  // sanitizePainterColor requires [r,g,b] tuple — never pass a THREE.Color (indexes → white)
  const fallbackRgb: readonly [number, number, number] = (() => {
    if (opts.fallback == null) return PAINTER_IDLE_RGB;
    if (Array.isArray(opts.fallback) && opts.fallback.length >= 3) {
      return [Number(opts.fallback[0]), Number(opts.fallback[1]), Number(opts.fallback[2])] as [
        number,
        number,
        number,
      ];
    }
    const c = new THREE.Color(opts.fallback as THREE.ColorRepresentation);
    return [c.r, c.g, c.b] as [number, number, number];
  })();
  const desat = sanitizeFinite(opts.desat ?? PAINTER_PIGMENT_DESAT, PAINTER_PIGMENT_DESAT, 0, 1);
  const maxCh = sanitizeFinite(
    opts.maxChannel ?? PAINTER_PIGMENT_MAX_CHANNEL,
    PAINTER_PIGMENT_MAX_CHANNEL,
    0.2,
    1,
  );
  // c13/c26: sanitize first so empty/unknown never become Three white, then wash neon
  const sanitized = sanitizePainterColor(input as unknown, fallbackRgb);
  const ok = sanitized.ok;
  const reason = sanitized.reason;
  if (!ok) {
    // Keep honest idle fallback exactly — do not wash/cap the error tint
    return { color: sanitized.color.clone(), satIn: 0, ok, reason };
  }
  const raw = sanitized.color.clone();
  const maxIn = Math.max(raw.r, raw.g, raw.b, 0);
  const minIn = Math.min(raw.r, raw.g, raw.b, 1);
  const satIn = maxIn > 1e-6 ? (maxIn - minIn) / maxIn : 0;
  // Mix toward luminance wash (paper), stronger when highly saturated / neon
  const lum = 0.2126 * raw.r + 0.7152 * raw.g + 0.0722 * raw.b;
  const wash = new THREE.Color(lum * 0.55 + 0.08, lum * 0.5 + 0.1, lum * 0.48 + 0.14);
  const neonPull = sanitizeFinite(desat * (0.35 + satIn * 0.9), desat, 0, 1);
  raw.r = raw.r + (wash.r - raw.r) * neonPull;
  raw.g = raw.g + (wash.g - raw.g) * neonPull;
  raw.b = raw.b + (wash.b - raw.b) * neonPull;
  const maxOut = Math.max(raw.r, raw.g, raw.b, 1e-6);
  if (maxOut > maxCh) {
    const s = maxCh / maxOut;
    raw.r *= s;
    raw.g *= s;
    raw.b *= s;
  }
  return { color: raw, satIn, ok, reason };
}

/** Glow sprite RGB scale from matte (quieter when matte=1). */
export function painterGlowColorScale(matte: number): number {
  const m = sanitizeFinite(matte, PAINTER_MATTE_DEFAULT, 0, 1);
  return (
    PAINTER_GLOW_COLOR_SCALE_OPEN +
    (PAINTER_GLOW_COLOR_SCALE_MATTE - PAINTER_GLOW_COLOR_SCALE_OPEN) * m
  );
}

/** Clamp emissive for watercolor path (Motion pulse may exceed 1). */
export function sanitizePainterEmissive(emissive: number, fallback = 0.75): number {
  return sanitizeFinite(emissive, fallback, 0, PAINTER_EMISSIVE_MAX);
}

