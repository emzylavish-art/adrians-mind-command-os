/**
 * Motion LOD + frame budget (Cosmos Motion Bot c3).
 *
 * Dust density follows the camera: full near the constellations, thinned when the camera
 * pulls out to the sky (dust is sub-pixel there and only costs matrix writes + overdraw).
 * A frame-budget governor trims the active instance count when frames run slow
 * (EMA > ~41 fps) and slowly restores it when there is headroom (hysteresis, no flapping).
 * Instances are seeded in random order, so dropping the tail removes a uniform subset.
 */
import { finiteOr } from "../motion/sanitize.ts";

export const LOD_NEAR = 22;
export const LOD_FAR = 70;
export const LOD_FAR_FACTOR = 0.35;
export const LOD_MIN_ACTIVE = 32;

/** 1 at/inside LOD_NEAR, LOD_FAR_FACTOR at/after LOD_FAR, smoothstep between. NaN → 1. */
export function dustDistanceFactor(camDistance: number): number {
  const d = finiteOr(camDistance, 0);
  if (d <= LOD_NEAR) return 1;
  if (d >= LOD_FAR) return LOD_FAR_FACTOR;
  const u = (d - LOD_NEAR) / (LOD_FAR - LOD_NEAR);
  const s = u * u * (3 - 2 * u);
  return 1 + (LOD_FAR_FACTOR - 1) * s;
}

export type FrameBudget = {
  /** Feed one raw wall frame delta (seconds). Gaps/NaN are ignored. Returns multiplier. */
  sample: (wallDtSeconds: number) => number;
  readonly multiplier: number;
  readonly emaMs: number;
};

export type FrameBudgetOpts = {
  /** Above this EMA frame time the budget shrinks. Default 24ms (~41fps). */
  slowMs?: number;
  /** Below this EMA frame time the budget recovers. Default 18ms (~55fps). */
  fastMs?: number;
  /** Lowest multiplier. Default 0.3. */
  floor?: number;
};

export function createFrameBudget(opts: FrameBudgetOpts = {}): FrameBudget {
  const slowMs = finiteOr(opts.slowMs ?? 24, 24);
  const fastMs = Math.min(finiteOr(opts.fastMs ?? 18, 18), slowMs);
  const floor = Math.min(1, Math.max(0.05, finiteOr(opts.floor ?? 0.3, 0.3)));
  let ema = 1000 / 60;
  let mult = 1;
  return {
    sample(dt: number) {
      // Ignore NaN, backwards clocks and tab-resume gaps (>250ms) — they are not render cost.
      if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25) return mult;
      ema += (dt * 1000 - ema) * 0.1;
      if (ema > slowMs) mult = Math.max(floor, mult - 0.01);
      else if (ema < fastMs) mult = Math.min(1, mult + 0.002);
      return mult;
    },
    get multiplier() {
      return mult;
    },
    get emaMs() {
      return ema;
    },
  };
}

/** Active instance count for `full` given distance factor and budget multiplier. */
export function lodCount(full: number, distanceFactor: number, budget: number, min = LOD_MIN_ACTIVE): number {
  const n = Math.max(0, Math.trunc(finiteOr(full, 0)));
  if (n === 0) return 0;
  const f = Math.min(1, Math.max(0, finiteOr(distanceFactor, 1)));
  const b = Math.min(1, Math.max(0, finiteOr(budget, 1)));
  const floor = Math.min(n, Math.max(0, Math.trunc(finiteOr(min, LOD_MIN_ACTIVE))));
  return Math.min(n, Math.max(floor, Math.round(n * f * b)));
}

/** True when the page is hidden (tab in background). Safe outside the browser. */
export function isDocumentHidden(doc: { hidden?: boolean } | undefined = (globalThis as { document?: { hidden?: boolean } }).document): boolean {
  return Boolean(doc && doc.hidden === true);
}
