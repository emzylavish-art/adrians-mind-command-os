import * as THREE from "three";
import { sanitizeFinite } from "./paper-grain.ts";

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
