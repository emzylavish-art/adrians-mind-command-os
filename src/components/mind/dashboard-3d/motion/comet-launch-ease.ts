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
  /**
   * c22: identity per slot (commit sha) for reconcileCometLaunch. Optional so
   * hand-built states stay valid; null = no identity (virgin / cleared).
   */
  keys?: (string | null)[];
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
  const keys: (string | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    slots[i] = { amount: 0, delay: 0, live: false };
    keys[i] = null;
  }
  return { slots, keys };
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
  if (state.keys) for (let i = 0; i < state.keys.length; i++) state.keys[i] = null;
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

/** Max chars of a key compared per slot (hostile mega-sha must not burn a frame). */
export const COMET_LAUNCH_KEY_MAX = 128;

let scratchAmount = new Float64Array(COMET_LAUNCH_MAX_BURST);
let scratchDelay = new Float64Array(COMET_LAUNCH_MAX_BURST);
let scratchLive = new Uint8Array(COMET_LAUNCH_MAX_BURST);
let scratchClaimed = new Uint8Array(COMET_LAUNCH_MAX_BURST);
let scratchKeys: (string | null)[] = new Array(COMET_LAUNCH_MAX_BURST).fill(null);
let scratchSrc = new Int32Array(COMET_LAUNCH_MAX_BURST);

function normKey(k: unknown): string | null {
  if (typeof k !== "string" || k.length === 0) return null;
  return k.length > COMET_LAUNCH_KEY_MAX ? k.slice(0, COMET_LAUNCH_KEY_MAX) : k;
}

/**
 * Hacker c22 (#91 comet churn): keyed reconcile for the scene's periodic comet rebuild.
 *
 * The scene rebuilt comets every 5s and called clearCometLaunch + scheduleCometLaunchBurst,
 * so every already-landed comet blinked to opacity 0 and re-launched every sync even when
 * the commit list was unchanged. reconcileCometLaunch compares slot i's key (commit sha)
 * with `keys[i]`:
 *  - same key → slot untouched (parked comets stay at amount=1, in-flight keep easing);
 *  - new/changed key → staggered launch (respecting maxConcurrent; overflow parks visible
 *    at amount=1 — never left hidden forever);
 *  - c23: key found at another old index (commit prepended) → carries that slot's state;
 *  - slot past keys.length (or empty key) → cleared hidden.
 * Reduced-motion → changed slots snap to amount=1. Returns how many slots animate a launch.
 * Zero allocation in steady state.
 */
export function reconcileCometLaunch(
  state: CometLaunchState,
  keys: readonly (string | null | undefined)[] | null | undefined,
  reducedMotion: boolean,
  opts: CometLaunchOpts = EMPTY_LAUNCH_OPTS,
): number {
  const o = opts ?? EMPTY_LAUNCH_OPTS;
  const stagger = Math.max(0, finiteOr(o.stagger ?? COMET_LAUNCH_STAGGER, COMET_LAUNCH_STAGGER));
  let maxConc: number;
  if (o.maxConcurrent === undefined || o.maxConcurrent === null) maxConc = COMET_LAUNCH_MAX_CONCURRENT;
  else if (!Number.isFinite(o.maxConcurrent as number) || (o.maxConcurrent as number) <= 0) maxConc = 0;
  else maxConc = clampInt(o.maxConcurrent as number, 1, COMET_LAUNCH_MAX_BURST, COMET_LAUNCH_MAX_CONCURRENT);

  const slots = state.slots;
  if (!state.keys || state.keys.length !== slots.length) {
    const prev = state.keys;
    const next: (string | null)[] = new Array(slots.length);
    for (let i = 0; i < slots.length; i++) next[i] = prev && i < prev.length ? prev[i] ?? null : null;
    state.keys = next;
  }
  const cur = state.keys;
  const list = Array.isArray(keys) ? keys : null;
  const n = list ? Math.min(list.length, slots.length) : 0;
  const m = slots.length;

  // c23: snapshot old slot state so a key that moved index (new commit prepended → every
  // sha shifts one slot) carries its landed/in-flight state instead of relaunching.
  // Module scratch — zero allocation in steady state.
  if (scratchAmount.length < m) {
    scratchAmount = new Float64Array(m);
    scratchDelay = new Float64Array(m);
    scratchLive = new Uint8Array(m);
    scratchClaimed = new Uint8Array(m);
    scratchKeys = new Array(m).fill(null);
    scratchSrc = new Int32Array(m);
  }
  for (let j = 0; j < m; j++) {
    const s = slots[j]!;
    scratchAmount[j] = finiteOr(s.amount, 0);
    scratchDelay[j] = finiteOr(s.delay, 0);
    scratchLive[j] = s.live ? 1 : 0;
    scratchClaimed[j] = 0;
    scratchKeys[j] = cur[j] ?? null;
  }

  // Pass 1: resolve each new key to an old slot (same index first, else first unclaimed
  // match). -1 = new key. Count live among carried slots for the concurrency budget.
  let live = 0;
  for (let i = 0; i < m; i++) {
    const k = i < n ? normKey(list![i]) : null;
    scratchSrc[i] = -1;
    if (k === null) continue;
    if (scratchKeys[i] === k && !scratchClaimed[i]) {
      scratchSrc[i] = i;
      scratchClaimed[i] = 1;
    }
  }
  // Moved-key search is O(m²); hand-built states past the burst cap skip it (relaunch as before).
  for (let i = 0; m <= COMET_LAUNCH_MAX_BURST && i < m; i++) {
    const k = i < n ? normKey(list![i]) : null;
    if (k === null || scratchSrc[i] !== -1) continue;
    for (let j = 0; j < m; j++) {
      if (!scratchClaimed[j] && scratchKeys[j] === k) {
        scratchSrc[i] = j;
        scratchClaimed[j] = 1;
        break;
      }
    }
  }
  for (let i = 0; i < m; i++) {
    const j = scratchSrc[i]!;
    if (j >= 0 && scratchLive[j]) live++;
  }

  let launched = 0;
  let delayCursor = 0;
  for (let i = 0; i < m; i++) {
    const s = slots[i]!;
    const k = i < n ? normKey(list![i]) : null;
    if (k === null) {
      s.amount = 0;
      s.delay = 0;
      s.live = false;
      cur[i] = null;
      continue;
    }
    const j = scratchSrc[i]!;
    cur[i] = k;
    if (j >= 0) {
      if (j !== i) {
        s.amount = scratchAmount[j]!;
        s.delay = scratchDelay[j]!;
        s.live = scratchLive[j] === 1;
      }
      continue;
    }
    if (reducedMotion || live >= maxConc) {
      // Static mark (reduced) or over concurrency budget: show landed, never hidden forever.
      s.amount = 1;
      s.delay = 0;
      s.live = false;
      continue;
    }
    s.amount = 0;
    s.delay = delayCursor;
    s.live = true;
    delayCursor += stagger;
    live++;
    launched++;
  }
  return launched;
}

/** Base comet head point size (matches particles/commit-comets material default floor). */
export const COMET_HEAD_SIZE_MIN = 0.12;

/**
 * Hacker c22: non-compounding head size. The scene did `mat.size = max(0.12, mat.size *
 * (0.85 + 0.15 * scale))` every frame, so each launch (scale < 1) shrank the head
 * permanently and the 5s relaunch pinned every head at the 0.12 floor. Derive from a fixed
 * base instead. Non-finite base → floor; reduced-motion → base.
 */
export function cometHeadSize(baseSize: number, sample: Readonly<CometLaunchSample> | null | undefined, reducedMotion: boolean): number {
  const base = Math.max(COMET_HEAD_SIZE_MIN, finiteOr(baseSize, COMET_HEAD_SIZE_MIN));
  if (reducedMotion || !sample) return base;
  const sc = clamp01((finiteOr(sample.scale, 1) - 0.6) / 0.4);
  return Math.max(COMET_HEAD_SIZE_MIN, base * (0.85 + 0.15 * sc));
}
