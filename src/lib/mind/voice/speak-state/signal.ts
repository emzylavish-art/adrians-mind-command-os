/** Level / VAD math for speak state. Linear RMS is the 0..1 value LiveMicStream already computes. */

/** About 50 Hz. Callers may deliver slower; the mic pump repeats the last sample up to this rate. */
export const LEVEL_INTERVAL_MS = 20;

export const VAD_START_PROB = 0.45;
export const VAD_END_PROB = 0.28;
export const VAD_START_HOLD_MS = 80;
export const VAD_END_HOLD_MS = 200;

/** While TTS plays, speech onset uses the raised barge threshold from voice-live/barge-in.ts. */
export const TTS_VAD_END_PROB = 0.62;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** dBFS relative to full scale. Silence floors at -100 dB. */
export function linearRmsToDb(rms: number): number {
  const clamped = Math.max(1e-5, clamp01(rms));
  return Math.round(20 * Math.log10(clamped) * 10) / 10;
}

/**
 * Map linear RMS onto 0..1.
 * ~0.12 (the live RMS barge threshold) lands near 0.54, under the TTS barge threshold.
 * ~0.35 lands near 0.90, which counts as sustained speech during TTS.
 */
export function vadProbFromLinearRms(rms: number): number {
  const x = clamp01(rms);
  return Math.round((1 - Math.exp(-x * 6.5)) * 1000) / 1000;
}
