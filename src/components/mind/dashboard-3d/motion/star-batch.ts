/**
 * Star-field batch sample helper (Cosmos Motion Bot c16).
 *
 * One call advances N stars: pulse + focus-ease + orbit-drift + focus apply.
 * Zero hot-path allocation when caller reuses parallel arrays / out buffers.
 * Motivated by c16 CPU budget (500 stars in one frame) and Dashboard wiring.
 *
 * Camera dolly toward focus stays with Dashboard Bot (`camera-rig` /
 * `stepRigSmooth`) — this helper only covers motion/ star samples.
 */
import { finiteOr } from "./sanitize.ts";
import { sharedMotionClock, type MotionClock } from "./motion-clock.ts";
import {
  sampleStarPulse,
  pulsePhaseFromId,
  type PulseHealth,
  type PulseSample,
} from "./star-pulse.ts";
import { sampleOrbitDrift, type Xyz } from "./orbit-drift.ts";
import {
  applyFocusDrift,
  applyFocusPulse,
  stepFocusEase,
  type FocusEaseState,
} from "./focus-ease.ts";

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

/**
 * Step `count` stars from parallel arrays (length >= count).
 * Returns count actually stepped (clamped to array lengths).
 */
export function stepStarFieldBatch(
  ids: ReadonlyArray<string>,
  healths: ReadonlyArray<PulseHealth | string>,
  bases: ReadonlyArray<Readonly<Xyz>>,
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
  const nWant = count == null ? ids.length : finiteOr(count, ids.length);
  const n = Math.max(
    0,
    Math.min(
      Math.floor(nWant),
      ids.length,
      healths.length,
      bases.length,
      focus.length,
      pulseOut.length,
      posOut.length,
    ),
  );
  for (let i = 0; i < n; i++) {
    const id = ids[i]!;
    const ph = pulsePhaseFromId(id);
    const pulse = pulseOut[i]!;
    const pos = posOut[i]!;
    const base = bases[i]!;
    sampleStarPulse(pulse, tSeconds, ph, healths[i]!, reducedMotion, clock);
    stepFocusEase(focus[i]!, id, focusId, dt, reducedMotion);
    applyFocusPulse(pulse, focus[i]!.pulseMul);
    sampleOrbitDrift(pos, base, tSeconds, ph, reducedMotion, { clock, radialAmp: 0.35, bobAmp: 0.2 });
    applyFocusDrift(pos, base, focus[i]!.driftMul);
  }
  return n;
}
