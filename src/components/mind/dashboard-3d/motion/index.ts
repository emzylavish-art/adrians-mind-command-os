/** motion/ — Cosmos Motion Bot lane (pulses, orbit drift, easing, reduced-motion). */
export {
  clamp01,
  damp,
  easeInOutCubic,
  easeOutQuint,
  lerp,
  smootherstep,
} from "./ease.ts";
export {
  normalizePulseHealth,
  pulsePhaseFromId,
  sampleStarPulse,
  type PulseHealth,
  type PulseSample,
} from "./star-pulse.ts";
export {
  sampleOrbitDrift,
  type OrbitDriftOpts,
  type Xyz,
} from "./orbit-drift.ts";
export { motionScale, prefersReducedMotion } from "./reduced-motion.ts";
export {
  clampInt,
  finiteOr,
  finiteXyz,
  sanitizeDt,
  sanitizeTime,
} from "./sanitize.ts";
export {
  createMotionClock,
  sharedMotionClock,
  type MotionClock,
  type MotionClockOpts,
} from "./motion-clock.ts";
export {
  FOCUS_DRIFT_LAMBDA,
  FOCUS_PULSE_LAMBDA,
  FOCUS_PULSE_SCALE,
  applyFocusDrift,
  applyFocusPulse,
  createFocusEaseState,
  isFocusedStar,
  stepFocusDriftMul,
  stepFocusEase,
  stepFocusPulseMul,
  type FocusEaseState,
} from "./focus-ease.ts";
export {
  NODE_OPEN_DURATION,
  NODE_OPEN_OFFSET_Y,
  NODE_OPEN_SCALE_FROM,
  SCENE_TRANSITION_DURATION,
  beginSceneTransition,
  cancelSceneTransition,
  createNodeOpenSample,
  createNodeOpenState,
  createSceneTransitionSample,
  createSceneTransitionState,
  normalizeSceneId,
  setNodeOpen,
  stepNodeOpen,
  stepSceneTransition,
  type NodeOpenOpts,
  type NodeOpenSample,
  type NodeOpenState,
  type SceneTransitionOpts,
  type SceneTransitionSample,
  type SceneTransitionState,
} from "./transition-ease.ts";

