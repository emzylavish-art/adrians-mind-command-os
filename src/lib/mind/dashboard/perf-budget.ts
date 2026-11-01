/**
 * Queue #17 — Perf budget at 18+ bots (pure).
 * Frame/draw hint when bot count ≥18; pause nonessential CSS2D under budget miss.
 * Hacker: NaN/neg/Infinity frame ms never force a pause forever; caps clamp.
 */

export const PERF_BOT_SOFT = 18;
export const PERF_FRAME_BUDGET_MS = 24;
export const PERF_FRAME_RECOVER_MS = 18;

export type PerfBudgetState = {
  botCount: number;
  softCapHit: boolean;
  labelsPaused: boolean;
  hint: string | null;
  emaFrameMs: number;
};

export function sanitizeFrameMs(raw: number, fallback = 16.7): number {
  if (!Number.isFinite(raw) || raw < 0 || raw > 5_000) return fallback;
  return raw;
}

export function nextEmaFrameMs(prevEma: number, sampleMs: number, alpha = 0.2): number {
  const p = sanitizeFrameMs(prevEma, 16.7);
  const s = sanitizeFrameMs(sampleMs, p);
  const a = Number.isFinite(alpha) && alpha > 0 && alpha <= 1 ? alpha : 0.2;
  return p * (1 - a) + s * a;
}

export function evaluatePerfBudget(input: {
  botCount: number;
  emaFrameMs: number;
  labelsPaused?: boolean;
}): PerfBudgetState {
  const botCount = Number.isFinite(input.botCount) ? Math.max(0, Math.min(10_000, Math.floor(input.botCount))) : 0;
  const emaFrameMs = sanitizeFrameMs(input.emaFrameMs, 16.7);
  const softCapHit = botCount >= PERF_BOT_SOFT;
  let labelsPaused = Boolean(input.labelsPaused);
  if (emaFrameMs > PERF_FRAME_BUDGET_MS && softCapHit) labelsPaused = true;
  else if (emaFrameMs < PERF_FRAME_RECOVER_MS) labelsPaused = false;
  const hint = softCapHit
    ? labelsPaused
      ? `Perf: ${botCount} bots · labels paused (EMA ${emaFrameMs.toFixed(1)}ms > ${PERF_FRAME_BUDGET_MS}ms)`
      : `Perf: ${botCount} bots · watch frame budget (EMA ${emaFrameMs.toFixed(1)}ms)`
    : null;
  return { botCount, softCapHit, labelsPaused, hint, emaFrameMs };
}
