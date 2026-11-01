/** atmosphere/ — Cosmos Light Bot lane (health-tinted lights + fog sync). */
export {
  AMBIENT_RGB,
  FOG_PARAMS,
  HEALTH_HEX,
  KEY_RGB,
  RIM_RGB,
  deriveFleetTone,
  isHealthTone,
  normalizeHealthTone,
  type HealthTone,
  type Rgb,
} from "./health-tone.ts";
export {
  createHealthAtmosphere,
  type CreateHealthAtmosphereOpts,
  type HealthAtmosphereHandle,
} from "./health-lights.ts";
export {
  FOCUS_EASE_MS,
  FOCUS_KEY_INTENSITY,
  FOCUS_RIM_INTENSITY,
  createFocusLight,
  focusKeyRgb,
  focusRigPlacement,
  focusRimRgb,
  type FocusLightHandle,
  type FocusLightInput,
  type FocusRigPlacement,
  type Vec3Like,
} from "./focus-light.ts";
export {
  BOUNCE_CHROMA,
  BOUNCE_EASE_MS,
  BOUNCE_INTENSITY,
  NEUTRAL_BOUNCE_RGB,
  averageLinearRgb,
  bouncePlacement,
  bounceRgbFromAverage,
  createPortraitBounce,
  domPixelReader,
  portraitTextureOf,
  readyImageSize,
  sampleTextureAverage,
  type PixelReader,
  type PortraitBounceHandle,
  type PortraitBounceInput,
} from "./portrait-bounce.ts";
