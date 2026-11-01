/** Convert PCM float samples to a 0..1 RMS level for waveform bars. */
export function rmsLevel(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i]!;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / n) * 2.2);
}

/** Map a 0..1 level onto bar height percents for a fixed bar count. */
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
