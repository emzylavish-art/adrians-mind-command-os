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
  type ContextLossError,
  type ContextLossErrorStage,
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
export {
  BLOOM_GUARD_EASE_MS,
  BLOOM_GUARD_FEATHER,
  BLOOM_GUARD_MAX,
  BLOOM_GUARD_RADIUS,
  BLOOM_GUARD_RADIUS_MAX,
  BLOOM_GUARD_RADIUS_MIN,
  FocusBloomGuardShader,
  bloomGuardKeepDepth,
  bloomGuardKeepRadial,
  clampGuardRadius,
  createFocusBloomGuard,
  projectedRadiusUv,
  type FocusBloomGuardHandle,
} from "./focus-bloom-guard.ts";
export {
  DIM_EASE_MS,
  DIM_FEATHER_PX,
  DIM_MAX,
  DIM_MAX_RECTS,
  DIM_PAD_PX,
  DetailBackdropDimShader,
  createDetailBackdropDimPass,
  dimFactor,
  rectMask,
  rectToUv,
  type DetailBackdropDimHandle,
  type RectLike,
  type UvRect,
  type ViewportLike,
} from "./detail-backdrop-dim.ts";
