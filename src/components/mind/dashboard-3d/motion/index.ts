/** motion/ — Cosmos Motion Bot lane (pulses, orbit drift, easing, reduced-motion). */
export {
  clamp01,
  damp,
  easeInOutCubic,
  easeOutQuint,
  lerp,
  smootherstep,
} from "./ease";
export {
  pulsePhaseFromId,
  sampleStarPulse,
  type PulseHealth,
  type PulseSample,
} from "./star-pulse";
export {
  sampleOrbitDrift,
  type OrbitDriftOpts,
  type Xyz,
} from "./orbit-drift";
export { motionScale, prefersReducedMotion } from "./reduced-motion";
