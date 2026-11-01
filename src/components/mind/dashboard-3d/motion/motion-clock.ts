/**
 * Continuous motion clock (hacker pass c3).
 *
 * UniverseScene feeds every motion sampler raw wall time (performance.now()/1000).
 * When the tab is hidden, rAF stops; on resume the next frame arrives minutes later and
 * every sin(t·speed) phase jumps — stars, orbits, dust and comets teleport in one frame.
 * sanitizeTime's 24h fold did the same once per day of uptime.
 *
 * map(wall) turns wall seconds into motion seconds: real deltas pass through, but any gap
 * larger than maxGap (or a backwards clock) advances by a single nominal frame instead.
 * Calling map() again with the same wall time in the same frame returns the same value, so
 * every sampler fed the same `t` stays phase-locked. Never allocates.
 */
import { sanitizeTime } from "./sanitize.ts";

export type MotionClock = {
  /** Wall seconds → continuous motion seconds. Non-finite input returns current time. */
  map: (wallSeconds: number) => number;
  /** Current motion time (seconds). */
  readonly time: number;
  /** Last raw wall delta (s) before gap clamping; 0 before the 2nd distinct frame. */
  readonly lastWallDt: number;
  reset: () => void;
};

export type MotionClockOpts = {
  /** Wall gap (s) above which a frame counts as a resume/jump. Default 0.25. */
  maxGap?: number;
  /** Step (s) applied for a clamped gap. Default 1/60. */
  nominalStep?: number;
};

export function createMotionClock(opts: MotionClockOpts = {}): MotionClock {
  const maxGap = Number.isFinite(opts.maxGap) && opts.maxGap! > 0 ? opts.maxGap! : 0.25;
  const nominal =
    Number.isFinite(opts.nominalStep) && opts.nominalStep! > 0 ? Math.min(opts.nominalStep!, maxGap) : 1 / 60;
  let lastWall: number | null = null;
  let time = 0;
  let lastWallDt = 0;
  const clock: MotionClock = {
    map(wall: number): number {
      if (!Number.isFinite(wall)) return time;
      if (lastWall === null) {
        lastWall = wall;
        time = sanitizeTime(wall);
        return time;
      }
      const d = wall - lastWall;
      if (d === 0) return time;
      lastWall = wall;
      lastWallDt = d;
      time += d > 0 && d <= maxGap ? d : nominal;
      return time;
    },
    get time() {
      return time;
    },
    get lastWallDt() {
      return lastWallDt;
    },
    reset() {
      lastWall = null;
      time = 0;
      lastWallDt = 0;
    },
  };
  return clock;
}

/** One clock shared by every motion/particle module so all samplers stay phase-locked. */
export const sharedMotionClock: MotionClock = createMotionClock();
