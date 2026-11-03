/**
 * Star focus breadcrumb HUD easing (Cosmos Motion Bot c8).
 *
 * Complements Dashboard queue #21 (star focus breadcrumb twin beside last-palette crumb).
 * Pure helpers only — Flyover HUD markup/CSS stay with Dashboard Bot.
 * Interruptible enter/exit: clearing mid-fade-in eases out from current amount.
 * Reduced-motion snaps. Wire `focusId` from `rig.subjectId`.
 */
import { clamp01, easeOutQuint, lerp } from "./ease.ts";
import { finiteOr, sanitizeDt } from "./sanitize.ts";

export const BREADCRUMB_DURATION = 0.28;
export const BREADCRUMB_SLIDE_PX = 12;

export type BreadcrumbEaseState = {
  /** 0 = hidden, 1 = fully shown. */
  amount: number;
  target: number;
  /** Currently shown focus id (null when hidden/exiting). */
  focusId: string | null;
};

export type BreadcrumbEaseSample = {
  /** Opacity 0 → 1. */
  opacity: number;
  /** Horizontal slide in px: -slidePx → 0 when entering. */
  offsetX: number;
  amount: number;
  done: boolean;
  focusId: string | null;
};

export type BreadcrumbEaseOpts = {
  duration?: number;
  /** Slide distance in CSS px (positive). Default BREADCRUMB_SLIDE_PX. */
  slidePx?: number;
};

const EMPTY_BC_OPTS: BreadcrumbEaseOpts = Object.freeze({});

export function createBreadcrumbEaseState(): BreadcrumbEaseState {
  return { amount: 0, target: 0, focusId: null };
}

export function createBreadcrumbEaseSample(): BreadcrumbEaseSample {
  return { opacity: 0, offsetX: -BREADCRUMB_SLIDE_PX, amount: 0, done: true, focusId: null };
}

function normalizeFocusId(id: string | null | undefined): string | null {
  if (typeof id !== "string") return null;
  const s = id.trim();
  return s.length === 0 ? null : s;
}

/**
 * Show / retarget the focus crumb. Empty/unknown id → hide (target 0).
 * Changing id while open keeps amount (label swap is HUD-side); opening from hidden eases in.
 */
export function setBreadcrumbFocus(
  state: BreadcrumbEaseState,
  focusId: string | null | undefined,
): void {
  const id = normalizeFocusId(focusId);
  if (id == null) {
    state.target = 0;
    return;
  }
  state.focusId = id;
  state.target = 1;
}

/** Begin exit easing (interruptible from any amount). */
export function clearBreadcrumbFocus(state: BreadcrumbEaseState): void {
  state.target = 0;
}

export function stepBreadcrumbEase(
  state: BreadcrumbEaseState,
  out: BreadcrumbEaseSample,
  dt: number,
  reducedMotion: boolean,
  opts: BreadcrumbEaseOpts = EMPTY_BC_OPTS,
): BreadcrumbEaseSample {
  const duration = Math.max(1e-4, finiteOr(opts.duration ?? BREADCRUMB_DURATION, BREADCRUMB_DURATION));
  const slidePx = Math.max(0, finiteOr(opts.slidePx ?? BREADCRUMB_SLIDE_PX, BREADCRUMB_SLIDE_PX));
  let target = finiteOr(state.target, 0);
  target = target >= 0.5 ? 1 : 0;
  state.target = target;
  let amount = clamp01(finiteOr(state.amount, 0));

  if (reducedMotion) {
    amount = target;
  } else if (amount !== target) {
    const step = sanitizeDt(dt) / duration;
    if (amount < target) amount = Math.min(target, amount + step);
    else amount = Math.max(target, amount - step);
  }
  state.amount = amount;

  // Clear stored id only once fully hidden so HUD can keep the label during exit fade.
  if (amount === 0 && target === 0) state.focusId = null;

  const e = easeOutQuint(amount);
  out.opacity = e;
  out.offsetX = lerp(-slidePx, 0, e);
  out.amount = amount;
  out.done = amount === target;
  out.focusId = state.focusId;
  return out;
}
