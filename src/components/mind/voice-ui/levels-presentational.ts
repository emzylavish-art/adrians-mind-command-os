/** Presentational twin of voice bot `levelToBarPercents` — same signature for wiring. */
export function levelToBarPercents(level: number, bars = 7): number[] {
  const clamped = Math.max(0, Math.min(1, level));
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const phase = (i / Math.max(1, bars - 1)) * Math.PI;
    const shape = 0.35 + 0.65 * Math.sin(phase);
    const height = Math.round((12 + clamped * 88 * shape) * 10) / 10;
    out.push(Math.min(100, height));
  }
  return out;
}
