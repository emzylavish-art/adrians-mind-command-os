/**
 * Star-field batch sample helper (Cosmos Motion Bot c16 / harden c17).
 *
 * One call advances N stars: pulse + focus-ease + orbit-drift + focus apply.
 * Zero hot-path allocation when caller reuses parallel arrays / out buffers.
 *
 * Camera dolly toward focus stays with Dashboard Bot (`camera-rig` /
 * `stepRigSmooth`) — this helper only covers motion/ star samples.
 *
 * Hacker c17: count 0 / 100k hard-cap, NaN bases → finite outs, id holes
 * skipped, mid-frame length shrink snapshotted, typed scratch reuse after dispose.
 */
import { finiteOr } from "./sanitize.ts";
import { sharedMotionClock, type MotionClock } from "./motion-clock.ts";
import {
  sampleStarPulse,
  pulsePhaseFromId,
  type PulseHealth,
  type PulseSample,
} from "./star-pulse.ts";
import { sampleOrbitDrift, type OrbitDriftOpts, type Xyz } from "./orbit-drift.ts";
import {
  applyFocusDrift,
  applyFocusPulse,
  createFocusEaseState,
  stepFocusEase,
  type FocusEaseState,
} from "./focus-ease.ts";

/** Hard cap so a corrupt count=1e5 cannot stall a frame. */
export const STAR_BATCH_MAX = 8192;

export type StarBatchSlot = {
  id: string;
  health: PulseHealth | string;
  base: Xyz;
  focus: FocusEaseState;
  pulse: PulseSample;
  pos: Xyz;
};

export type StarBatchOpts = {
  clock?: MotionClock;
};

const EMPTY_BATCH_OPTS: StarBatchOpts = Object.freeze({});

/** Reused per-star orbit opts — never allocate `{ clock, radialAmp, bobAmp }` in the hot loop (c18). */
export const STAR_BATCH_ORBIT_OPTS: OrbitDriftOpts = {
  radialAmp: 0.35,
  bobAmp: 0.2,
};

/**
 * Reusable scratch for Dashboard Bot: packed Float32 bases + object views.
 * `disposeStarBatchScratch` zeros typed arrays and marks disposed; pass the
 * same object back to `createStarBatchScratch` to re-arm without realloc when
 * capacity matches.
 */
export type StarBatchScratch = {
  capacity: number;
  disposed: boolean;
  ids: string[];
  healths: (PulseHealth | string)[];
  /** Packed xyz (length capacity*3). */
  baseXYZ: Float32Array;
  /** Object views over baseXYZ / posXYZ — stable identity across dispose+reuse. */
  bases: Xyz[];
  posXYZ: Float32Array;
  pos: Xyz[];
  focus: FocusEaseState[];
  pulse: PulseSample[];
};

function bindPackedViews(
  xyz: Float32Array,
  views: Xyz[],
  capacity: number,
): void {
  for (let i = 0; i < capacity; i++) {
    const o = i * 3;
    const existing = views[i];
    if (existing) {
      Object.defineProperties(existing, {
        x: {
          get: () => xyz[o]!,
          set: (v: number) => {
            xyz[o] = v;
          },
          configurable: true,
          enumerable: true,
        },
        y: {
          get: () => xyz[o + 1]!,
          set: (v: number) => {
            xyz[o + 1] = v;
          },
          configurable: true,
          enumerable: true,
        },
        z: {
          get: () => xyz[o + 2]!,
          set: (v: number) => {
            xyz[o + 2] = v;
          },
          configurable: true,
          enumerable: true,
        },
      });
    } else {
      views[i] = {
        get x() {
          return xyz[o]!;
        },
        set x(v: number) {
          xyz[o] = v;
        },
        get y() {
          return xyz[o + 1]!;
        },
        set y(v: number) {
          xyz[o + 1] = v;
        },
        get z() {
          return xyz[o + 2]!;
        },
        set z(v: number) {
          xyz[o + 2] = v;
        },
      };
    }
  }
}

export function createStarBatchScratch(
  capacity: number,
  reuse?: StarBatchScratch | null,
): StarBatchScratch {
  const cap = Math.max(0, Math.min(STAR_BATCH_MAX, Math.floor(finiteOr(capacity, 0))));
  if (
    reuse &&
    reuse.capacity === cap &&
    reuse.baseXYZ instanceof Float32Array &&
    reuse.posXYZ instanceof Float32Array &&
    reuse.baseXYZ.length === cap * 3 &&
    reuse.posXYZ.length === cap * 3
  ) {
    reuse.disposed = false;
    reuse.baseXYZ.fill(0);
    reuse.posXYZ.fill(0);
    for (let i = 0; i < cap; i++) {
      reuse.ids[i] = "";
      reuse.healths[i] = "idle";
      const f = reuse.focus[i] ?? createFocusEaseState();
      f.pulseMul = 1;
      f.driftMul = 1;
      reuse.focus[i] = f;
      const p = reuse.pulse[i] ?? { scale: 1, glow: 2, emissive: 0.5 };
      p.scale = 1;
      p.glow = 2;
      p.emissive = 0.5;
      reuse.pulse[i] = p;
    }
    reuse.ids.length = cap;
    reuse.healths.length = cap;
    reuse.focus.length = cap;
    reuse.pulse.length = cap;
    reuse.bases.length = cap;
    reuse.pos.length = cap;
    bindPackedViews(reuse.baseXYZ, reuse.bases, cap);
    bindPackedViews(reuse.posXYZ, reuse.pos, cap);
    return reuse;
  }
  const baseXYZ = new Float32Array(cap * 3);
  const posXYZ = new Float32Array(cap * 3);
  const bases: Xyz[] = new Array(cap);
  const pos: Xyz[] = new Array(cap);
  bindPackedViews(baseXYZ, bases, cap);
  bindPackedViews(posXYZ, pos, cap);
  const scratch: StarBatchScratch = {
    capacity: cap,
    disposed: false,
    ids: Array.from({ length: cap }, () => ""),
    healths: Array.from({ length: cap }, () => "idle" as PulseHealth | string),
    baseXYZ,
    bases,
    posXYZ,
    pos,
    focus: Array.from({ length: cap }, () => createFocusEaseState()),
    pulse: Array.from({ length: cap }, () => ({ scale: 1, glow: 2, emissive: 0.5 })),
  };
  return scratch;
}

export function disposeStarBatchScratch(scratch: StarBatchScratch): void {
  if (!scratch || scratch.disposed) return;
  scratch.disposed = true;
  if (scratch.baseXYZ instanceof Float32Array) scratch.baseXYZ.fill(0);
  if (scratch.posXYZ instanceof Float32Array) scratch.posXYZ.fill(0);
  for (let i = 0; i < scratch.capacity; i++) {
    scratch.ids[i] = "";
    scratch.healths[i] = "idle";
    const f = scratch.focus[i];
    if (f) {
      f.pulseMul = 1;
      f.driftMul = 1;
    }
    const p = scratch.pulse[i];
    if (p) {
      p.scale = 1;
      p.glow = 2;
      p.emissive = 0.5;
    }
  }
}

/**
 * Step `count` stars from parallel arrays (length >= count).
 * Returns count actually stepped (holes skipped; clamped to STAR_BATCH_MAX).
 * Snapshots lengths at entry so mid-frame shrinks cannot walk off the end.
 */
export function stepStarFieldBatch(
  ids: ReadonlyArray<string | null | undefined>,
  healths: ReadonlyArray<PulseHealth | string | null | undefined>,
  bases: ReadonlyArray<Readonly<Xyz> | null | undefined>,
  focus: FocusEaseState[],
  pulseOut: PulseSample[],
  posOut: Xyz[],
  focusId: string | null | undefined,
  tSeconds: number,
  dt: number,
  reducedMotion: boolean,
  count?: number,
  opts: StarBatchOpts = EMPTY_BATCH_OPTS,
): number {
  const o = opts ?? EMPTY_BATCH_OPTS;
  const clock = o.clock ?? sharedMotionClock;

  // Snapshot lengths once — mid-frame mutation must not extend the loop.
  const lenIds = ids?.length ?? 0;
  const lenHealth = healths?.length ?? 0;
  const lenBases = bases?.length ?? 0;
  const lenFocus = focus?.length ?? 0;
  const lenPulse = pulseOut?.length ?? 0;
  const lenPos = posOut?.length ?? 0;

  const nWant = count == null ? lenIds : finiteOr(count, lenIds);
  const n = Math.max(
    0,
    Math.min(
      Math.floor(nWant),
      STAR_BATCH_MAX,
      lenIds,
      lenHealth,
      lenBases,
      lenFocus,
      lenPulse,
      lenPos,
    ),
  );

  STAR_BATCH_ORBIT_OPTS.clock = clock;
  let stepped = 0;
  for (let i = 0; i < n; i++) {
    // Re-check live length in case caller shrunk arrays mid-frame.
    if (i >= ids.length || i >= healths.length || i >= bases.length) break;
    if (i >= focus.length || i >= pulseOut.length || i >= posOut.length) break;

    const id = ids[i];
    const base = bases[i];
    const focusState = focus[i];
    const pulse = pulseOut[i];
    const pos = posOut[i];
    // Hole / removed slot — skip without throwing.
    if (id == null || id === "" || base == null || focusState == null || pulse == null || pos == null) {
      continue;
    }

    const ph = pulsePhaseFromId(id);
    const health = healths[i] ?? "idle";
    sampleStarPulse(pulse, tSeconds, ph, health, reducedMotion, clock);
    stepFocusEase(focusState, id, focusId, dt, reducedMotion);
    applyFocusPulse(pulse, focusState.pulseMul);
    sampleOrbitDrift(pos, base, tSeconds, ph, reducedMotion, STAR_BATCH_ORBIT_OPTS);
    applyFocusDrift(pos, base, focusState.driftMul);

    // Belt: keep outs finite even if upstream ever regresses NaN handling.
    if (!Number.isFinite(pos.x)) pos.x = 0;
    if (!Number.isFinite(pos.y)) pos.y = 0;
    if (!Number.isFinite(pos.z)) pos.z = 0;
    if (!Number.isFinite(pulse.scale)) pulse.scale = 1;
    if (!Number.isFinite(pulse.glow)) pulse.glow = 2;
    if (!Number.isFinite(pulse.emissive)) pulse.emissive = 0.5;

    stepped++;
  }
  return stepped;
}
