/**
 * Continuous motion clock (hacker pass c3).
 *
 * UniverseScene feeds every motion sampler raw wall time (performance.now()/1000).
 * When the tab is hidden, rAF stops; on resume the next frame arrives minutes later and
 * every sin(t·speed) phase jumps — stars, orbits, dust and comets teleport in one frame.
 * sanitizeTime's 24h fold did the same once per day of uptime.
 *
 * map(wall) turns wall seconds into motion seconds: real deltas pass through (stutters are
 * capped at maxGap); a true resume gap (or a backwards clock) advances one nominal frame.
 * Calling map() again with the same wall time in the same frame returns the same value, so
 * every sampler fed the same `t` stays phase-locked. Never allocates.
 */
import { sanitizeTime } from "./sanitize.ts";

export type MotionClock = {
  /** Wall seconds → continuous motion seconds. Non-finite input returns current time. */
  map: (wallSeconds: number) => number;
  /** Motion time returned by the latest map() call (seconds). */
  readonly time: number;
  /** Last raw wall delta (s) for the source just mapped; 0/negative/huge on resume or new source. */
  readonly lastWallDt: number;
  /** Live anchors (one per time base seen recently); bounded by MAX_ANCHORS. */
  readonly anchorCount: number;
  reset: () => void;
};

export type MotionClockOpts = {
  /** Largest wall delta (s) passed through 1:1. Default 0.25. */
  maxGap?: number;
  /** Deltas in (maxGap, maxStall] are stutters: advance maxGap. Above = resume. Default 1. */
  maxStall?: number;
  /** Step (s) applied on resume / new time base. Default 1/60. */
  nominalStep?: number;
};

export const MAX_ANCHORS = 4;

type Anchor = { wall: number; time: number; used: number; live: boolean };

/**
 * Hacker pass c4: a single (wall,time) pair broke when two time bases fed the clock in one
 * frame (each call looked like a jump → motion ran at calls×1/60 per frame), and sustained
 * slow frames (>250ms) froze motion at 1/60 per frame. Now each time base gets its own
 * anchor (≤4, LRU), stutters advance maxGap, and only true resumes (>maxStall) collapse.
 */
export function createMotionClock(opts: MotionClockOpts = {}): MotionClock {
  const maxGap = Number.isFinite(opts.maxGap) && opts.maxGap! > 0 ? opts.maxGap! : 0.25;
  const maxStall = Number.isFinite(opts.maxStall) && opts.maxStall! >= maxGap ? opts.maxStall! : Math.max(1, maxGap);
  const nominal =
    Number.isFinite(opts.nominalStep) && opts.nominalStep! > 0 ? Math.min(opts.nominalStep!, maxGap) : 1 / 60;
  const anchors: Anchor[] = [];
  for (let i = 0; i < MAX_ANCHORS; i++) anchors.push({ wall: 0, time: 0, used: 0, live: false });
  let useTick = 0;
  let time = 0;
  let lastWallDt = 0;
  let mru: Anchor | null = null;

  const clock: MotionClock = {
    map(wall: number): number {
      if (!Number.isFinite(wall)) return time;
      useTick++;
      let best: Anchor | null = null;
      let bestD = Infinity;
      for (let i = 0; i < MAX_ANCHORS; i++) {
        const a = anchors[i]!;
        if (!a.live) continue;
        const d = wall - a.wall;
        if (d >= 0 && d <= maxStall && d < bestD) {
          best = a;
          bestD = d;
        }
      }
      if (best) {
        best.used = useTick;
        if (bestD > 0) {
          best.time += bestD <= maxGap ? bestD : maxGap;
          best.wall = wall;
          lastWallDt = bestD;
        }
        mru = best;
        time = best.time;
        return time;
      }
      // Resume after a gap, backwards clock, or a new time base: continue from the most
      // recently used anchor one nominal frame later (first ever call keeps wall phase).
      let slot = anchors[0]!;
      for (let i = 0; i < MAX_ANCHORS; i++) {
        const a = anchors[i]!;
        if (!a.live) {
          slot = a;
          break;
        }
        if (a.used < slot.used) slot = a;
      }
      // Hacker c11: backwards worker clocks must not publish negative lastWallDt (LOD budget).
      lastWallDt = mru ? Math.max(0, wall - mru.wall) : 0;
      const nextTime = mru ? mru.time + nominal : sanitizeTime(wall);
      slot.live = true;
      slot.wall = wall;
      slot.time = nextTime;
      slot.used = useTick;
      mru = slot;
      time = nextTime;
      return time;
    },
    get time() {
      return time;
    },
    get lastWallDt() {
      return lastWallDt;
    },
    get anchorCount() {
      let n = 0;
      for (const a of anchors) if (a.live) n++;
      return n;
    },
    reset() {
      for (const a of anchors) a.live = false;
      mru = null;
      time = 0;
      lastWallDt = 0;
      useTick = 0;
    },
  };
  return clock;
}

/**
 * Process-wide clock so every sampler stays phase-locked.
 * Hacker c7: `reset()` is a **no-op** on the shared singleton. Resetting it from one
 * UniverseScene mount / HMR teardown (or a second canvas) snaps lagged motion time back
 * to raw wall time and teleports stars/orbits/dust still ticking on another mount.
 * Use `createMotionClock()` when you need a private, resettable clock (tests, isolated scenes).
 */
const _sharedMotionClockInner: MotionClock = createMotionClock();
export const sharedMotionClock: MotionClock = {
  map: (wallSeconds: number) => _sharedMotionClockInner.map(wallSeconds),
  get time() {
    return _sharedMotionClockInner.time;
  },
  get lastWallDt() {
    return _sharedMotionClockInner.lastWallDt;
  },
  get anchorCount() {
    return _sharedMotionClockInner.anchorCount;
  },
  reset() {
    /* intentionally empty — see comment above */
  },
};

/**
 * Explicit hard reset of the process-wide shared clock.
 * Prefer `createMotionClock()` for production isolation. Use this only in tests or a
 * deliberate full-dashboard teardown when you accept a one-frame phase snap for every
 * sampler still reading `sharedMotionClock`.
 * Grep of origin/dashboard-3d (c8): nothing calls `sharedMotionClock.reset()` for effect.
 */
export function hardResetSharedMotionClockForTests(): void {
  _sharedMotionClockInner.reset();
}
