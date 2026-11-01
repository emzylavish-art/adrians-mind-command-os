/**
 * postfx/ — Cosmos Light Bot lane.
 * Bloom tuning + health color grade. Painterly grain stays in universe-scene.
 */
export {
  BLOOM_BY_TONE,
  BLOOM_MAX_EDGE,
  bloomParamsForTone,
  inferPixelRatio,
  safeBloomSize,
  createTunedBloomPass,
  type BloomTuning,
  type TunedBloomHandle,
} from "./bloom-tuning.ts";
export {
  ColorGradeShader,
  GRADE_BY_TONE,
  colorGradeParamsForTone,
  createColorGradePass,
  type ColorGradeHandle,
  type ColorGradeTuning,
} from "./color-grade.ts";
export {
  GOD_RAY_SAMPLES,
  GodRayShader,
  createGodRayPass,
  godRayIntensity,
  linearDepthOf,
  sunScreenUv,
  type GodRayHandle,
  type GodRayInputs,
  type SunScreen,
} from "./god-rays.ts";
export {
  EXPOSURE_BY_TONE,
  EXPOSURE_EASE_MS,
  EXPOSURE_MAX,
  EXPOSURE_MIN,
  bloomThresholdFor,
  clampExposure,
  createExposureRide,
  exposureTargetFor,
  timeOfDayExposureScale,
  type ExposureRideHandle,
  type ExposureRideInputs,
  type ExposureRideState,
} from "./exposure-ride.ts";
export {
  createContextLossRecovery,
  type ContextLossCanvas,
  type ContextLossHandle,
  type CreateContextLossOpts,
  type PostfxBundle,
  type PostfxRebuildFactory,
} from "./context-loss.ts";
export {
  FOCUS_BAND,
  FOCUS_DEPTH_EASE_MS,
  FOCUS_DEPTH_MAX,
  FOCUS_RAMP,
  FocusDepthShader,
  createFocusDepthPass,
  focusBandWeight,
  type FocusDepthHandle,
} from "./focus-depth.ts";
export { isDepthClobbered, liveSceneDepth, markDepthClobbered } from "./depth-validity.ts";
