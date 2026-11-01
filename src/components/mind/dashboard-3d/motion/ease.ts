/** Shared transition / camera-adjacent easing (zero-alloc friendly). */
import { finiteOr, sanitizeDt } from "./sanitize.ts";

export function clamp01(t: number): number {
  const x = finiteOr(t, 0);
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeOutQuint(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 5);
}

export function smootherstep(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Framerate-independent exponential damp toward target. Caps dt for tab resume. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  const c = finiteOr(current, 0);
  const tgt = finiteOr(target, c);
  const lam = finiteOr(lambda, 0);
  if (lam <= 0) return tgt;
  const d = sanitizeDt(dt, 0.05);
  return tgt + (c - tgt) * Math.exp(-lam * d);
}

export function lerp(a: number, b: number, t: number): number {
  return finiteOr(a, 0) + (finiteOr(b, 0) - finiteOr(a, 0)) * clamp01(t);
}
