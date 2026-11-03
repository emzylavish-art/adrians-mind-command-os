/** Mic input level helpers for the voice level meter (AnalyserNode time-domain → 0..1). */

export function rmsFromTimeDomain(bytes: ArrayLike<number>): number {
  const n = bytes.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    // AnalyserNode getByteTimeDomainData: 128 is silence.
    const centered = ((bytes[i] ?? 128) - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / n) * 2.5);
}

export function rmsFromFloatSamples(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / n) * 2.2);
}

/** Idle meter is flat zero; while listening use the live RMS. */
export function meterValue(listening: boolean, level: number): number {
  if (!listening) return 0;
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(1, level));
}

export function levelToBarPercents(level: number, bars = 5): number[] {
  const clamped = meterValue(true, level);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const phase = (i / Math.max(1, bars - 1)) * Math.PI;
    const shape = 0.35 + 0.65 * Math.sin(phase);
    out.push(Math.round((8 + clamped * 92 * shape) * 10) / 10);
  }
  return out;
}
