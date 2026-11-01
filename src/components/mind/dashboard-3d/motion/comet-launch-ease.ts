/**
 * Comet launch ease on commit burst (Cosmos Motion Bot c14).
 *
 * Pure scheduling + ease for N comets spawning in a fleet commit burst.
 * Staggers starts, caps concurrent live launches, ease-out opacity/scale.
 * Interruptible clear mid-burst. Reduced-motion → static marks (amount=1, no stagger).
 * Particles/commit-comets owns meshes; Dashboard wires schedule → slot opacity.
 * c15: maxConcurrent=0 schedules nothing; huge burst counts clamp (REA fps cliff).
 */
import { clamp01, easeOutQuint, lerp } from "./ease.ts";
import { finiteOr, sanitizeDt, clampInt } from "./sanitize.ts";

export const COMET_LAUNCH_STAGGER = 0.09;
export const COMET_LAUNCH_DURATION = 0.32;
export const COMET_LAUNCH_MAX_CONCURRENT = 6;
export const COMET_LAUNCH_MAX_BURST = 24;

export type CometLaunchSlot = {
  /** 0 hidden → 1 fully launched. */
  amount: number;
  /** Seconds remaining before ease begins. */
  delay: number;
  live: boolean;
};

export type CometLaunchState = {
  slots: CometLaunchSlot[];
};

export type CometLaunchSample = {
  opacity: number;
  scale: number;
  amount: number;
  /** True once delay elapsed and amount > 0 (mesh may show). */
  visible: boolean;
  done: boolean;
};

export type CometLaunchOpts = {
  stagger?: number;
  duration?: number;
  maxConcurrent?: number;
};

const EMPTY_LAUNCH_OPTS: CometLaunchOpts = Object.freeze({});

export function createCometLaunchState(capacity = COMET_LAUNCH_MAX_BURST): CometLaunchState {
  const n = clampInt(capacity, 0, COMET_LAUNCH_MAX_BURST, COMET_LAUNCH_MAX_BURST);
  const slots: CometLaunchSlot[] = new Array(n);
  for (let i = 0; i < n; i++) slots[i] = { amount: 0, delay: 0, live: false };
  return { slots };
}

export function createCometLaunchSample(): CometLaunchSample {
  return { opacity: 0, scale: 0.6, amount: 0, visible: false, done: true };
}

/** Cancel in-flight burst (interruptible). */
export function clearCometLaunch(state: CometLaunchState): void {
  for (const s of state.slots) {
    s.amount = 0;
    s.delay = 0;
    s.live = false;
  }
}

/**
 * Schedule a burst of `count` launches into free/finished slots.
 * Caps at min(count, slots.length, maxConcurrent pacing via stagger).
 * Re-entrant: appends into non-live slots without resetting live ones.
 */
export function scheduleCometLaunchBurst(
  state: CometLaunchState,
  count: number,
  reducedMotion: boolean,
  opts: CometLaunchOpts = EMPTY_LAUNCH_OPTS,
): number {
  const o = opts ?? EMPTY_LAUNCH_OPTS;
  const stagger = Math.max(0, finiteOr(o.stagger ?? COMET_LAUNCH_STAGGER, COMET_LAUNCH_STAGGER));
  // Hacker c15: explicit maxConcurrent=0 means no new launches (REA: unbounded bursts hurt fps).
  // Non-finite / omitted → default. Negative → 0.
  let maxConc: number;
  if (o.maxConcurrent === undefined || o.maxConcurrent === null) {
    maxConc = COMET_LAUNCH_MAX_CONCURRENT;
  } else if (!Number.isFinite(o.maxConcurrent as number) || (o.maxConcurrent as number) < 0) {
    maxConc = 0;
  } else if ((o.maxConcurrent as number) === 0) {
    maxConc = 0;
  } else {
    maxConc = clampInt(o.maxConcurrent as number, 1, COMET_LAUNCH_MAX_BURST, COMET_LAUNCH_MAX_CONCURRENT);
  }
  // Huge burst counts clamp — never walk 10k times.
  const want = clampInt(count, 0, COMET_LAUNCH_MAX_BURST, 0);
  if (want <= 0) return 0;

  let live = 0;
  for (const s of state.slots) if (s.live) live++;
  const room = reducedMotion
    ? state.slots.length - live
    : Math.max(0, Math.min(maxConc - live, state.slots.length - live));
  const toSched = Math.min(want, room);
  if (toSched <= 0) return 0;

  let scheduled = 0;
  let delayCursor = 0;
  for (let i = 0; i < state.slots.length && scheduled < toSched; i++) {
    const s = state.slots[i]!;
    if (s.live) continue;
    if (reducedMotion) {
      s.delay = 0;
      s.amount = 1;
      s.live = true;
    } else {
      s.delay = delayCursor;
      s.amount = 0;
      s.live = true;
      delayCursor += stagger;
    }
    scheduled++;
  }
  return scheduled;
}

export function stepCometLaunchEase(
  state: CometLaunchState,
  out: CometLaunchSample[],
  dt: number,
  reducedMotion: boolean,
  opts: CometLaunchOpts = EMPTY_LAUNCH_OPTS,
): void {
  const o = opts ?? EMPTY_LAUNCH_OPTS;
  const duration = Math.max(1e-4, finiteOr(o.duration ?? COMET_LAUNCH_DURATION, COMET_LAUNCH_DURATION));
  const d = sanitizeDt(dt);

  for (let i = 0; i < state.slots.length; i++) {
    const s = state.slots[i]!;
    let sample = out[i];
    if (!sample) {
      sample = createCometLaunchSample();
      out[i] = sample;
    }
    if (!s.live) {
      // Finished launch parks at amount=1; virgin/cleared slots stay hidden at 0.
      if (s.amount >= 1 - 1e-4) {
        sample.amount = 1;
        sample.opacity = 1;
        sample.scale = 1;
        sample.visible = true;
        sample.done = true;
      } else {
        sample.opacity = 0;
        sample.scale = 0.6;
        sample.amount = 0;
        sample.visible = false;
        sample.done = true;
      }
      continue;
    }
    if (reducedMotion) {
      s.delay = 0;
      s.amount = 1;
      s.live = false;
      sample.amount = 1;
      sample.opacity = 1;
      sample.scale = 1;
      sample.visible = true;
      sample.done = true;
      continue;
    }
    if (s.delay > 0) {
      s.delay = Math.max(0, finiteOr(s.delay, 0) - d);
      sample.amount = 0;
      sample.opacity = 0;
      sample.scale = 0.6;
      sample.visible = false;
      sample.done = false;
      continue;
    }
    s.amount = clamp01(finiteOr(s.amount, 0) + d / duration);
    const e = easeOutQuint(s.amount);
    sample.amount = s.amount;
    sample.opacity = e;
    sample.scale = lerp(0.6, 1, e);
    sample.visible = s.amount > 1e-4;
    sample.done = s.amount >= 1 - 1e-4;
    // Free concurrency slot once fully launched (mesh stays at amount=1 via sample).
    if (sample.done) s.live = false;
  }
}
