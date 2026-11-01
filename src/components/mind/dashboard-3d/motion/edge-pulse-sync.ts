/**
 * Constellation edge highlight pulse sync (Cosmos Motion Bot c11).
 *
 * Complements Dashboard #26 / Gap#4 edge highlight + hover tooltip motion (c10).
 * Pure helpers: phase-lock edge highlight to star pulse / MotionClock, travel a
 * highlight wave along the edge toward the focused (or hovered) node, and damp
 * neighbor pulse. Reduced-motion → static highlight (no travel, steady strength).
 *
 * Dashboard Bot wires `hoverOut.edge` / focusId into `stepEdgePulseSync`.
 */
import { clamp01 } from "./ease.ts";
import { finiteOr } from "./sanitize.ts";
import { characterPhaseFromId } from "./character-motion.ts";
import { sharedMotionClock, type MotionClock } from "./motion-clock.ts";

export const EDGE_PULSE_SPEED = 2.2;
export const EDGE_TRAVEL_SPEED = 1.4;
export const EDGE_PULSE_AMP = 0.18;
export const EDGE_NEIGHBOR_DAMP = 0.55;

export type EdgePulseState = {
  /** Travel phase accumulator (radians-ish via time). */
  travel: number;
};

export type EdgePulseSample = {
  /** Steady highlight strength 0..1 (typically hover edge opacity). */
  strength: number;
  /** Wave head along edge 0 (fromId) → 1 (toId), oriented toward focus. */
  travel: number;
  /** Pulse modulation centered at 1 (0.82..1.18-ish). */
  pulse: number;
  /** Combined ribbon highlight = strength * pulse (clamped). */
  highlight: number;
  /** Neighbor star pulse scale multiplier when this edge is live. */
  neighborPulseMul: number;
};

export type EdgePulseOpts = {
  clock?: MotionClock;
  pulseSpeed?: number;
  travelSpeed?: number;
  pulseAmp?: number;
  neighborDamp?: number;
};

const EMPTY_EDGE_OPTS: EdgePulseOpts = Object.freeze({});

export function createEdgePulseState(): EdgePulseState {
  return { travel: 0 };
}

export function createEdgePulseSample(): EdgePulseSample {
  return { strength: 0, travel: 0, pulse: 1, highlight: 0, neighborPulseMul: 1 };
}

function normalizeId(id: string | null | undefined): string | null {
  if (typeof id !== "string") return null;
  const s = id.trim();
  return s.length === 0 ? null : s;
}

/**
 * Orient travel so 0 = far end, 1 = toward `focusId` when focus matches an endpoint.
 * If focus matches neither / null, travel runs fromId → toId.
 * Returns true when travel should run toward `toId` (false → toward fromId, inverted).
 */
export function edgeTravelTowardTo(
  fromId: string | null | undefined,
  toId: string | null | undefined,
  focusId: string | null | undefined,
): boolean {
  const focus = normalizeId(focusId);
  const to = normalizeId(toId);
  const from = normalizeId(fromId);
  if (focus != null && from != null && focus === from) return false;
  if (focus != null && to != null && focus === to) return true;
  return true;
}

/**
 * Sample one constellation edge. `strength` is usually hover tooltip `edge` (0..1).
 * `focusId` orients travel; phase locks to MotionClock + endpoint id hash.
 */
export function stepEdgePulseSync(
  state: EdgePulseState,
  out: EdgePulseSample,
  strength: number,
  fromId: string | null | undefined,
  toId: string | null | undefined,
  focusId: string | null | undefined,
  tSeconds: number,
  reducedMotion: boolean,
  opts: EdgePulseOpts = EMPTY_EDGE_OPTS,
): EdgePulseSample {
  const o = opts ?? EMPTY_EDGE_OPTS;
  const s = clamp01(finiteOr(strength, 0));
  const clock = o.clock ?? sharedMotionClock;
  const pulseSpeed = finiteOr(o.pulseSpeed ?? EDGE_PULSE_SPEED, EDGE_PULSE_SPEED);
  const travelSpeed = Math.max(0, finiteOr(o.travelSpeed ?? EDGE_TRAVEL_SPEED, EDGE_TRAVEL_SPEED));
  const amp = Math.max(0, finiteOr(o.pulseAmp ?? EDGE_PULSE_AMP, EDGE_PULSE_AMP));
  const damp = clamp01(finiteOr(o.neighborDamp ?? EDGE_NEIGHBOR_DAMP, EDGE_NEIGHBOR_DAMP));

  out.strength = s;

  if (s <= 1e-6) {
    state.travel = 0;
    out.travel = 0;
    out.pulse = 1;
    out.highlight = 0;
    out.neighborPulseMul = 1;
    return out;
  }

  if (reducedMotion) {
    state.travel = 0;
    out.travel = 0.5;
    out.pulse = 1;
    out.highlight = s;
    out.neighborPulseMul = 1 - (1 - damp) * s;
    return out;
  }

  const t = clock.map(tSeconds);
  const towardTo = edgeTravelTowardTo(fromId, toId, focusId);
  // Phase from the destination endpoint so wave locks to that star's pulse phase.
  const destId = towardTo ? toId : fromId;
  const phase = characterPhaseFromId(destId);
  const wave = Math.sin(t * pulseSpeed + phase);
  out.pulse = 1 + wave * amp;

  // Travel 0..1 looping, oriented toward focus.
  let travel = (t * travelSpeed + phase * 0.1) % 1;
  if (travel < 0) travel += 1;
  if (!towardTo) travel = 1 - travel;
  state.travel = travel;
  out.travel = travel;

  out.highlight = clamp01(s * out.pulse);
  // Damp neighbor pulse toward rest as highlight strengthens.
  out.neighborPulseMul = 1 - (1 - damp) * s;
  return out;
}
