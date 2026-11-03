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
export {
  motionScale,
  prefersReducedMotion,
  shouldScheduleUniverseFrame,
  shouldSoftSyncScene,
  subscribePrefersReducedMotion,
  universeMotionSignature,
} from "./reduced-motion.ts";
export type { UniverseFrameSchedule, UniverseMotionSignatureInput } from "./reduced-motion.ts";
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
