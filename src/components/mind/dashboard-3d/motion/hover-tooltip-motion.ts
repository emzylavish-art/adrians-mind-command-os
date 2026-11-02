/**
 * Star hover tooltip + edge-highlight motion (Cosmos Motion Bot c10).
 *
 * Complements Dashboard queue #26 / Gap#4 (health/lane/branch/heartbeat tooltip +
 * constellation edge highlight). Pure helpers only — HUD markup/CSS stay with
 * Dashboard Bot. Interruptible: leaving mid-fade-in eases out from current amount.
 *
 * Anti-jitter: a short hover-intent delay before committing a new star id, so the
 * pointer skimming star edges does not thrash show/hide. Re-entering the same id
 * before hide completes cancels the exit. Reduced-motion snaps.
 */
import { clamp01, easeOutQuint, lerp } from "./ease.ts";
import { finiteOr, sanitizeDt } from "./sanitize.ts";

export const HOVER_INTENT_DELAY = 0.09;
export const HOVER_FADE_DURATION = 0.22;
export const HOVER_LIFT_PX = 8;
export const HOVER_SCALE_FROM = 0.96;
export const HOVER_SCALE_TO = 1;

export type HoverTooltipState = {
  /** 0 = hidden, 1 = fully shown (tooltip opacity/scale source). */
  amount: number;
  target: number;
  /** Committed hover id (null when hidden / exiting with no retarget). */
  hoverId: string | null;
  /** Candidate id waiting out the intent delay (may equal hoverId). */
  pendingId: string | null;
  /** Seconds spent dwelling on pendingId. */
  dwell: number;
};

export type HoverTooltipSample = {
  opacity: number;
  /** Vertical lift in CSS px: +lift → 0 when entering. */
  offsetY: number;
  scale: number;
  /** 0→1 edge highlight strength (same curve as opacity). */
  edge: number;
  amount: number;
  done: boolean;
  hoverId: string | null;
};

export type HoverTooltipOpts = {
  intentDelay?: number;
  duration?: number;
  liftPx?: number;
  scaleFrom?: number;
  scaleTo?: number;
};

const EMPTY_HOVER_OPTS: HoverTooltipOpts = Object.freeze({});

export function createHoverTooltipState(): HoverTooltipState {
  return { amount: 0, target: 0, hoverId: null, pendingId: null, dwell: 0 };
}

export function createHoverTooltipSample(): HoverTooltipSample {
  return {
    opacity: 0,
    offsetY: HOVER_LIFT_PX,
    scale: HOVER_SCALE_FROM,
    edge: 0,
    amount: 0,
    done: true,
    hoverId: null,
  };
}

function normalizeHoverId(id: string | null | undefined): string | null {
  if (typeof id !== "string") return null;
  const s = id.trim();
  return s.length === 0 ? null : s;
}

/**
 * Pointer moved onto `starId` (or null = left all stars).
 * Does not commit immediately — `stepHoverTooltip` applies the intent delay so
 * edge-crossing flicker cannot flip hoverId every frame.
 */
export function setHoverTooltipTarget(
  state: HoverTooltipState,
  starId: string | null | undefined,
): void {
  const id = normalizeHoverId(starId);
  if (id === state.pendingId) return;
  state.pendingId = id;
  state.dwell = 0;
  // Leaving entirely: begin exit immediately (no delay to hide).
  if (id == null) {
    state.target = 0;
    return;
  }
  // Same committed id again (re-enter while exiting): cancel exit, keep amount.
  if (id === state.hoverId) {
    state.target = 1;
  }
}

/** Force-hide (e.g. camera fly / focus opens). Interruptible from any amount. */
export function clearHoverTooltip(state: HoverTooltipState): void {
  state.pendingId = null;
  state.dwell = 0;
  state.target = 0;
}

export function stepHoverTooltip(
  state: HoverTooltipState,
  out: HoverTooltipSample,
  dt: number,
  reducedMotion: boolean,
  opts: HoverTooltipOpts = EMPTY_HOVER_OPTS,
): HoverTooltipSample {
  const o = opts ?? EMPTY_HOVER_OPTS;
  const delay = finiteOr(o.intentDelay ?? HOVER_INTENT_DELAY, HOVER_INTENT_DELAY);
  const duration = Math.max(1e-4, finiteOr(o.duration ?? HOVER_FADE_DURATION, HOVER_FADE_DURATION));
  const liftPx = finiteOr(o.liftPx ?? HOVER_LIFT_PX, HOVER_LIFT_PX);
  const scaleFrom = finiteOr(o.scaleFrom ?? HOVER_SCALE_FROM, HOVER_SCALE_FROM);
  const scaleTo = finiteOr(o.scaleTo ?? HOVER_SCALE_TO, HOVER_SCALE_TO);
  const d = sanitizeDt(dt);

  // Intent gate: dwell on pending before committing a *new* id.
  if (state.pendingId != null && state.pendingId !== state.hoverId) {
    state.dwell = finiteOr(state.dwell, 0) + d;
    const ready = reducedMotion || delay <= 0 || state.dwell >= delay;
    if (ready) {
      state.hoverId = state.pendingId;
      state.target = 1;
      state.dwell = 0;
    }
  } else if (state.pendingId != null && state.pendingId === state.hoverId) {
    state.target = 1;
    state.dwell = 0;
  } else if (state.pendingId == null) {
    state.target = 0;
    state.dwell = 0;
  }

  const target = state.target >= 0.5 ? 1 : 0;
  if (reducedMotion) {
    state.amount = target;
  } else {
    const step = d / duration;
    if (target > state.amount) {
      state.amount = clamp01(state.amount + step);
    } else if (target < state.amount) {
      state.amount = clamp01(state.amount - step);
    }
  }

  // Once fully hidden, drop the committed id so the next enter is a clean show.
  if (state.amount <= 1e-4 && target === 0) {
    state.amount = 0;
    if (state.pendingId == null) state.hoverId = null;
  }

  const a = clamp01(finiteOr(state.amount, 0));
  const e = easeOutQuint(a);
  out.amount = a;
  out.opacity = e;
  out.edge = e;
  out.offsetY = lerp(liftPx, 0, e);
  out.scale = lerp(scaleFrom, scaleTo, e);
  out.done = (target === 1 && a >= 1 - 1e-4) || (target === 0 && a <= 1e-4);
  out.hoverId = state.hoverId;
  return out;
}
