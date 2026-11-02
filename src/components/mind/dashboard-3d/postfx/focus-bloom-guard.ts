import * as THREE from "three";
import type { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { LuminosityHighPassShader } from "three/examples/jsm/shaders/LuminosityHighPassShader.js";
import { PREFILTER_GLSL } from "./bloom-prefilter.ts";
import { liveSceneDepth } from "./depth-validity.ts";
import { FOCUS_BAND, FOCUS_RAMP, focusBandWeight } from "./focus-depth.ts";
import { linearDepthOf, sunScreenUv } from "./god-rays.ts";

/**
 * Focus-aware bloom guard (light lane, queue #57; builds on #56 focus depth).
 *
 * While a node is focused, the bloom SOURCE (UnrealBloomPass luminosity
 * high-pass) is masked inside the focus band, so bright Imagine portrait /
 * card highlights stop hazing over the detail the user is reading. Pixels
 * outside the band keep the normal health-tone bloom. Mask source:
 * - scene depth (same band/ramp as focus-depth) when the bloom readBuffer
 *   still holds real depth (see depth-validity.ts);
 * - otherwise a soft radial mask around the focused node's screen position,
 *   sized by `radiusUv` (screen-height fraction; see projectedRadiusUv).
 *
 * The guard only swaps the high-pass material while active, so with no focus
 * bloom is byte-identical to before (zero cost). Reduced motion snaps the
 * guard on/off (static, no easing). Junk input → no guard (bloom unchanged).
 */

export const BLOOM_GUARD_EASE_MS = 300;
/** Max suppression of the bloom source inside the focus band (keeps a hint of glow). */
export const BLOOM_GUARD_MAX = 0.78;
/** Default crisp radius for the radial fallback, in screen-height units. */
export const BLOOM_GUARD_RADIUS = 0.16;
/** Radial feather beyond the radius (screen-height units). */
export const BLOOM_GUARD_FEATHER = 0.14;
export const BLOOM_GUARD_RADIUS_MIN = 0.04;
export const BLOOM_GUARD_RADIUS_MAX = 0.45;

function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** JS mirror (depth mode): bloom source kept 0..1. In band → 1-guard, outside → 1. Junk → 1. */
export function bloomGuardKeepDepth(
  depth: number,
  focusDepth: number,
  guard: number,
  band = FOCUS_BAND,
  ramp = FOCUS_RAMP,
): number {
  if (![depth, focusDepth, guard, band, ramp].every(Number.isFinite) || ramp <= 0) return 1;
  const g = Math.min(1, Math.max(0, guard));
  return 1 - g * (1 - focusBandWeight(depth, focusDepth, band, ramp));
}

/** JS mirror (radial mode): `dist` in screen-height units from the focus point. Junk → 1. */
export function bloomGuardKeepRadial(
  dist: number,
  guard: number,
  radius = BLOOM_GUARD_RADIUS,
  feather = BLOOM_GUARD_FEATHER,
): number {
  if (![dist, guard, radius, feather].every(Number.isFinite) || feather <= 0) return 1;
  const g = Math.min(1, Math.max(0, guard));
  return 1 - g * (1 - smooth01((Math.abs(dist) - Math.max(0, radius)) / feather));
}

/** Clamp a caller radius (screen-height fraction). Junk → default. */
export function clampGuardRadius(r: number | undefined): number {
  if (r === undefined || !Number.isFinite(r) || r <= 0) return BLOOM_GUARD_RADIUS;
  return Math.min(BLOOM_GUARD_RADIUS_MAX, Math.max(BLOOM_GUARD_RADIUS_MIN, r));
}

/**
 * Projected radius of a world-space sphere (e.g. node + Imagine card bounds)
 * as a fraction of screen height, padded 15%. Non-perspective / junk / behind
 * camera → null (caller keeps the default radius).
 *
 * Hacker (cycle after #93): returns the REAL radius, unclamped. It used to
 * run clampGuardRadius() here, so the #84 card probe metered far cards at
 * 0.04 (mostly backdrop, reported as the card) and the #93 rim was drawn at
 * 0.45 across close-up card faces. Guard / hole / key-lift consumers clamp it
 * themselves (clampGuardRadius) — pass it straight through.
 */
export function projectedRadiusUv(
  world: THREE.Vector3,
  radiusWorld: number,
  camera: THREE.Camera,
): number | null {
  const cam = camera as THREE.PerspectiveCamera;
  if (!cam.isPerspectiveCamera || !Number.isFinite(radiusWorld) || radiusWorld <= 0) return null;
  if (![world.x, world.y, world.z].every(Number.isFinite)) return null;
  camera.updateMatrixWorld();
  const viewZ = -world.clone().applyMatrix4(camera.matrixWorldInverse).z;
  if (!Number.isFinite(viewZ) || viewZ <= cam.near) return null;
  const halfH = viewZ * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  if (!(halfH > 0)) return null;
  // Screen height spans 2*halfH; fraction = r / (2*halfH).
  const r = (radiusWorld / (2 * halfH)) * 1.15;
  return Number.isFinite(r) && r > 0 ? r : null;
}

export const FocusBloomGuardShader = {
  name: "FocusBloomGuardShader",
  uniforms: {
    ...LuminosityHighPassShader.uniforms,
    tDepth: { value: null as THREE.Texture | null },
    useDepth: { value: 0 },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    focusDepth: { value: 0.5 },
    focusUv: { value: new THREE.Vector2(0.5, 0.5) },
    aspect: { value: 1 },
    band: { value: FOCUS_BAND },
    ramp: { value: FOCUS_RAMP },
    radius: { value: BLOOM_GUARD_RADIUS },
    feather: { value: BLOOM_GUARD_FEATHER },
    guard: { value: 0 },
    // #112: same bright-pass prefilter as the tuned bloom (taps = 1 → stock).
    uPrefilterTaps: { value: 1 },
    uPrefilterSpacing: { value: new THREE.Vector2(0, 0) },
    uSrcTexel: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: LuminosityHighPassShader.vertexShader,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform vec3 defaultColor;
    uniform float defaultOpacity;
    uniform float luminosityThreshold;
    uniform float smoothWidth;
    uniform sampler2D tDepth;
    uniform float useDepth;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float focusDepth;
    uniform vec2 focusUv;
    uniform float aspect;
    uniform float band;
    uniform float ramp;
    uniform float radius;
    uniform float feather;
    uniform float guard;
    varying vec2 vUv;
    ${PREFILTER_GLSL}

    void main() {
      vec4 bright = lightBrightPass(vUv);
      float outside;
      if (useDepth > 0.5) {
        float fragZ = texture2D(tDepth, vUv).x;
        float viewZ = perspectiveDepthToViewZ(fragZ, cameraNear, cameraFar);
        float lin = viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
        outside = smoothstep(0.0, 1.0, clamp((abs(lin - focusDepth) - band) / ramp, 0.0, 1.0));
      } else {
        vec2 d = (vUv - focusUv) * vec2(aspect, 1.0);
        outside = smoothstep(0.0, 1.0, clamp((length(d) - radius) / feather, 0.0, 1.0));
      }
      float keep = 1.0 - clamp(guard, 0.0, 1.0) * (1.0 - outside);
      gl_FragColor = bright * keep;
    }
  `,
};

type BloomLike = UnrealBloomPass;

export type FocusBloomGuardHandle = {
  /** The guarded bloom pass (unchanged object; same one in the composer). */
  bloom: BloomLike;
  /** Effective guard 0..BLOOM_GUARD_MAX (0 = original bloom). */
  readonly guard: number;
  /** True while the guard material is swapped in. */
  readonly active: boolean;
  /**
   * Focus a world point (null = clear). `radiusUv` sizes the radial fallback
   * (use projectedRadiusUv with the node + card bounds); junk → default.
   */
  setFocus: (
    world: THREE.Vector3 | null,
    camera: THREE.Camera,
    opts?: { reducedMotion?: boolean; radiusUv?: number },
  ) => void;
  /** Sticky depth when the bloom readBuffer has no depth attachment. */
  setDepthTexture: (tex: THREE.Texture | null) => void;
  tick: (dtMs: number) => void;
  /** Restores the original high-pass material/render and frees the guard material. */
  dispose: () => void;
};

type GuardUniforms = {
  [K in keyof typeof FocusBloomGuardShader.uniforms]: {
    value: (typeof FocusBloomGuardShader.uniforms)[K]["value"];
  };
};

/**
 * Attach a focus guard to an UnrealBloomPass (or a TunedBloomHandle `{ pass }`).
 * Re-create after WebGL context restore (the bloom pass is rebuilt).
 */
export function createFocusBloomGuard(target: BloomLike | { pass: BloomLike }): FocusBloomGuardHandle {
  const bloom = ("pass" in target && target.pass ? target.pass : target) as BloomLike;
  const origMaterial = bloom.materialHighPassFilter;
  const origUniforms = bloom.highPassUniforms;
  const origRender = bloom.render;
  const origDispose = bloom.dispose;

  const material = new THREE.ShaderMaterial({
    name: "FocusBloomGuard",
    uniforms: THREE.UniformsUtils.clone(FocusBloomGuardShader.uniforms),
    vertexShader: FocusBloomGuardShader.vertexShader,
    fragmentShader: FocusBloomGuardShader.fragmentShader,
  });
  const u = material.uniforms as unknown as GuardUniforms;
  const smoothW = (origUniforms as Record<string, { value: unknown }>)?.smoothWidth?.value;
  if (typeof smoothW === "number" && Number.isFinite(smoothW)) u.smoothWidth.value = smoothW;

  let disposed = false;
  let active = false;
  let level = 0;
  let target01 = 0;
  let from = 0;
  let elapsed = BLOOM_GUARD_EASE_MS;
  let reduced = false;
  let sticky: THREE.Texture | null = null;

  const swap = (on: boolean) => {
    if (on === active) return;
    active = on;
    bloom.materialHighPassFilter = on ? material : origMaterial;
    bloom.highPassUniforms = (on ? material.uniforms : origUniforms) as typeof bloom.highPassUniforms;
  };
  const apply = () => {
    u.guard.value = disposed ? 0 : BLOOM_GUARD_MAX * level;
    swap(!disposed && u.guard.value > 0.001);
  };

  bloom.render = function guardedRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    if (!active) return origRender.call(bloom, renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    const depth = liveSceneDepth(renderer, readBuffer, sticky);
    u.tDepth.value = depth;
    u.useDepth.value = depth ? 1 : 0;
    const w = readBuffer?.width ?? 1;
    const h = readBuffer?.height ?? 1;
    u.aspect.value = w > 0 && h > 0 ? w / h : 1;
    try {
      origRender.call(bloom, renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      // Never leave depth bound between draws (feedback-loop guard).
      u.tDepth.value = null;
      u.useDepth.value = 0;
    }
  } as typeof bloom.render;

  const teardown = () => {
    if (disposed) return;
    disposed = true;
    level = 0;
    target01 = 0;
    apply(); // swaps the original material back
    u.tDepth.value = null;
    sticky = null;
    bloom.render = origRender;
    bloom.dispose = origDispose;
    material.dispose();
  };

  // If the bloom pass is disposed first (context loss), restore + free ours too.
  bloom.dispose = function guardedDispose() {
    teardown();
    origDispose.call(bloom);
    // Upstream dispose skips the high-pass material; free the original here.
    origMaterial?.dispose();
  } as typeof bloom.dispose;

  return {
    bloom,
    get guard() {
      return disposed ? 0 : u.guard.value;
    },
    get active() {
      return active;
    },
    setFocus(world, camera, opts = {}) {
      if (disposed) return;
      reduced = !!opts.reducedMotion;
      let next = 0;
      if (world && camera && [world.x, world.y, world.z].every(Number.isFinite)) {
        camera.updateMatrixWorld();
        const s = sunScreenUv(world, camera);
        if (s.visible) {
          next = 1;
          u.focusUv.value.set(s.uv[0], s.uv[1]);
          u.focusDepth.value = linearDepthOf(world, camera);
          u.radius.value = clampGuardRadius(opts.radiusUv);
          const cam = camera as THREE.PerspectiveCamera;
          if (cam.isPerspectiveCamera) {
            u.cameraNear.value = cam.near;
            u.cameraFar.value = cam.far;
          }
        }
      }
      if (next !== target01) {
        from = level;
        target01 = next;
        elapsed = 0;
      }
      if (reduced) {
        level = target01;
        elapsed = BLOOM_GUARD_EASE_MS;
      }
      apply();
    },
    setDepthTexture(tex) {
      if (disposed) return;
      sticky = tex;
      u.tDepth.value = null;
      u.useDepth.value = 0;
    },
    tick(dtMs) {
      if (disposed) return;
      const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
      if (reduced || elapsed >= BLOOM_GUARD_EASE_MS) {
        level = target01;
      } else {
        elapsed = Math.min(BLOOM_GUARD_EASE_MS, elapsed + dt);
        const t = smooth01(elapsed / BLOOM_GUARD_EASE_MS);
        level = from + (target01 - from) * t;
      }
      apply();
    },
    dispose: teardown,
  };
}
