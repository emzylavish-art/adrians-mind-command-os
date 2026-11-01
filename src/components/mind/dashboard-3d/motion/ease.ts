/** Shared transition / camera-adjacent easing (zero-alloc friendly). */

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
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

/** Framerate-independent exponential damp toward target. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * Math.max(0, dt));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}
