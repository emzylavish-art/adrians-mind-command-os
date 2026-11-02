import * as THREE from "three";
import { sanitizeFinite } from "./paper-grain.ts";

/** Soft GPU budget for painter-owned / tracked textures (RGBA8 estimate). */
export const PAINTER_TEXTURE_BUDGET_BYTES = 48 * 1024 * 1024; // 48 MiB
export const PAINTER_TEXTURE_BUDGET_MIN = 2 * 1024 * 1024;
export const PAINTER_TEXTURE_BUDGET_MAX = 256 * 1024 * 1024;

export type PainterlyTextureBudgetItem = {
  id: string;
  bytes: number;
  width: number;
  height: number;
};

export type PainterlyTextureBudgetReport = {
  bytes: number;
  budget: number;
  overBudget: boolean;
  remaining: number;
  items: PainterlyTextureBudgetItem[];
};

export function sanitizeTextureBudgetBytes(budget: number, fallback = PAINTER_TEXTURE_BUDGET_BYTES): number {
  return Math.floor(
    sanitizeFinite(budget, fallback, PAINTER_TEXTURE_BUDGET_MIN, PAINTER_TEXTURE_BUDGET_MAX),
  );
}

/**
 * Estimate GPU footprint of a texture (RGBA8 × w × h; mipmaps ≈ ×1.33 when enabled).
 * Missing/invalid dims → 0 (honest, not fabricated).
 */
export function estimateTextureBytes(tex: THREE.Texture | null | undefined): {
  bytes: number;
  width: number;
  height: number;
} {
  if (!tex) return { bytes: 0, width: 0, height: 0 };
  const img = (tex as THREE.Texture & { image?: { width?: number; height?: number } }).image;
  let w = 0;
  let h = 0;
  if (tex instanceof THREE.DataTexture) {
    w = Number((tex as THREE.DataTexture).image?.width ?? 0);
    h = Number((tex as THREE.DataTexture).image?.height ?? 0);
    // DataTexture stores width/height on the texture in three r152+
    if (!w || !h) {
      w = Number((tex as unknown as { width?: number }).width ?? 0);
      h = Number((tex as unknown as { height?: number }).height ?? 0);
    }
  }
  if ((!w || !h) && img && typeof img === "object") {
    w = Number(img.width ?? 0);
    h = Number(img.height ?? 0);
  }
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    return { bytes: 0, width: 0, height: 0 };
  }
  w = Math.floor(w);
  h = Math.floor(h);
  let bytes = w * h * 4;
  // generateMipmaps defaults true on many textures → ~4/3 factor
  if ((tex as THREE.Texture).generateMipmaps) bytes = Math.floor(bytes * 1.333333);
  return { bytes, width: w, height: h };
}

export function pushBudgetItem(
  items: PainterlyTextureBudgetItem[],
  id: string,
  tex: THREE.Texture | null | undefined,
): number {
  const e = estimateTextureBytes(tex);
  if (e.bytes > 0) items.push({ id, bytes: e.bytes, width: e.width, height: e.height });
  return e.bytes;
}

export type PainterlyBudgetDegradeState = {
  overBudget: boolean;
  degraded: boolean;
  warned: boolean;
  degradeCount: number;
  lastBytes: number;
  /** Consecutive under-budget samples while degraded (hysteresis). */
  underBudgetStreak: number;
};

/** Exit degrade only after this many consecutive under-budget samples. */
export const BUDGET_HYSTERESIS_FRAMES = 8;
/** Exit degrade only when bytes <= budget * ratio (avoids edge flicker). */
export const BUDGET_HYSTERESIS_RATIO = 0.92;

export function createBudgetDegradeState(): PainterlyBudgetDegradeState {
  return {
    overBudget: false,
    degraded: false,
    warned: false,
    degradeCount: 0,
    lastBytes: 0,
    underBudgetStreak: 0,
  };
}

/**
 * HACKER (c17): soft cap was report-only (silent). When overBudget, mark degraded and
 * warn once so operators see it — callers should visibly ease pass grain/fiber.
 * HACKER (c18): toggling overBudget every frame flickered degrade — enter immediately,
 * exit only after BUDGET_HYSTERESIS_FRAMES under-budget samples AND bytes ≤ budget×ratio.
 */
export function noteTextureBudgetReport(
  state: PainterlyBudgetDegradeState,
  report: Pick<PainterlyTextureBudgetReport, "bytes" | "budget" | "overBudget">,
): PainterlyBudgetDegradeState {
  state.lastBytes = report.bytes;
  state.overBudget = !!report.overBudget;
  if (report.overBudget) {
    state.degraded = true;
    state.degradeCount += 1;
    state.underBudgetStreak = 0;
    if (!state.warned) {
      state.warned = true;
      try {
        console.warn(
          "[painterly-kit] texture budget exceeded — degrading paper grain/fiber (soft cap)",
          { bytes: report.bytes, budget: report.budget },
        );
      } catch {
        /* */
      }
    }
  } else {
    state.underBudgetStreak = (state.underBudgetStreak || 0) + 1;
    const exitBytes =
      Number.isFinite(report.budget) && report.budget > 0
        ? report.budget * BUDGET_HYSTERESIS_RATIO
        : 0;
    if (
      state.degraded &&
      state.underBudgetStreak >= BUDGET_HYSTERESIS_FRAMES &&
      report.bytes <= exitBytes
    ) {
      state.degraded = false;
      // Allow a fresh warn if budget is exceeded again after recovery.
      state.warned = false;
    }
  }
  return state;
}
