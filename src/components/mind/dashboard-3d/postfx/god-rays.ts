import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { liveSceneDepth, markDepthClobbered } from "./depth-validity.ts";
import { KEY_RGB, normalizeHealthTone, type HealthTone } from "../atmosphere/health-tone.ts";
import { GOD_RAY_MAX_TAPS, createGodRayBudget, godRayTapParams, type GodRayBudgetOpts, type GodRayTapParams } from "./god-ray-budget.ts";

/**
 * Depth-aware god-ray shafts (light lane, queue #11).
 *
 * Screen-space radial light scattering (GPU Gems 3 ch.13) from the orchestrator
 * "sun". Only bright pixels at or behind the sun's own depth emit: when a depth
 * texture is attached, anything nearer than the sun (stars, buildings) occludes
 * the shafts instead of smearing them. Without depth it falls back to a
 * luminance mask so the pass is still honest on renderers with no depth target.
 *
 * Intensity is tied to the real healthy/total ratio; it is OFF (pass.enabled =
 * false) under reduced motion, with no data, with zero healthy nodes, or when
 * the sun is behind the camera.
 */

/** Max taps (loop bound). The live count is adaptive — see god-ray-budget.ts (#109). */
export const GOD_RAY_SAMPLES = GOD_RAY_MAX_TAPS;

export type GodRayInputs = {
  healthy: number;
  total: number;
  reducedMotion: boolean;
};

/** 0 → off. Otherwise 0.25..0.8 scaled by healthy ratio. Junk input → 0. */
export function godRayIntensity({ healthy, total, reducedMotion }: GodRayInputs): number {
  if (reducedMotion) return 0;
  if (!Number.isFinite(healthy) || !Number.isFinite(total) || total <= 0 || healthy <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, healthy / total));
  return 0.25 + 0.55 * ratio;
}

export type SunScreen = {
  uv: [number, number];
  visible: boolean;
  edgeFade: number;
  /** Sun linear depth 0..1 between camera near/far (perspective cameras), else 1. */
  depth: number;
};

/** Linear 0..1 depth of a world point for a perspective camera (1 if not perspective). */
export function linearDepthOf(world: THREE.Vector3, camera: THREE.Camera): number {
  const cam = camera as THREE.PerspectiveCamera;
  if (!cam.isPerspectiveCamera) return 1;
  const viewZ = -world.clone().applyMatrix4(camera.matrixWorldInverse).z;
  const d = (viewZ - cam.near) / (cam.far - cam.near);
  return Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 1;
}

/**
 * Project the sun to screen UV. Behind the camera → invisible. Off-screen suns
 * fade out over half a screen so shafts don't pop at the frame edge.
 */
export function sunScreenUv(sunWorld: THREE.Vector3, camera: THREE.Camera): SunScreen {
  const v = sunWorld.clone().project(camera);
  const uv: [number, number] = [v.x * 0.5 + 0.5, v.y * 0.5 + 0.5];
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z) || v.z > 1 || v.z < -1) {
    return { uv: [0.5, 0.5], visible: false, edgeFade: 0, depth: 1 };
  }
  const over = Math.max(0, Math.abs(v.x) - 1, Math.abs(v.y) - 1);
  const edgeFade = Math.max(0, 1 - over / 1.0);
  return { uv, visible: edgeFade > 0, edgeFade, depth: linearDepthOf(sunWorld, camera) };
}

export const GodRayShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    useDepth: { value: 0 },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    /** Sun linear depth; pixels nearer than (sunDepth - depthBias) occlude. */
    sunDepth: { value: 1 },
    depthBias: { value: 0.02 },
    sunUv: { value: new THREE.Vector2(0.5, 0.5) },
    intensity: { value: 0 },
    /** Per-tap decay for the live tap count (re-based by godRayTapParams). */
    decay: { value: 0.955 },
    /** Live tap count (<= SAMPLES) and its energy normalisation (#109). */
    taps: { value: GOD_RAY_MAX_TAPS },
    tapNorm: { value: 1 / (GOD_RAY_MAX_TAPS * 0.25) },
    density: { value: 0.82 },
    weight: { value: 0.42 },
    lumThreshold: { value: 0.55 },
    tint: { value: new THREE.Color(1, 0.92, 0.72) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    #include <packing>
    #define SAMPLES ${GOD_RAY_SAMPLES}
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float useDepth;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float sunDepth;
    uniform float depthBias;
    uniform vec2 sunUv;
    uniform float intensity;
    uniform float decay;
    uniform float taps;
    uniform float tapNorm;
    uniform float density;
    uniform float weight;
    uniform float lumThreshold;
    uniform vec3 tint;
    varying vec2 vUv;

    float linDepth(vec2 uv) {
      float fragZ = texture2D(tDepth, uv).x;
      float viewZ = perspectiveDepthToViewZ(fragZ, cameraNear, cameraFar);
      return viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
    }

    // Emission mask: bright AND far (sky / sun) pixels only.
    float emit(vec2 uv, out vec3 col) {
      col = texture2D(tDiffuse, uv).rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float bright = smoothstep(lumThreshold, lumThreshold + 0.25, l);
      float far = useDepth > 0.5 ? step(sunDepth - depthBias, linDepth(uv)) : 1.0;
      return bright * far;
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (intensity <= 0.0) { gl_FragColor = base; return; }
      float n = clamp(taps, 1.0, float(SAMPLES));
      // Same screen-space reach (density, UV) whatever the tap count.
      vec2 delta = (vUv - sunUv) * (density / n);
      // Interleaved-gradient jitter hides the step banding.
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec2 uv = vUv - delta * jitter;
      float illum = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        if (float(i) >= n) break;
        uv -= delta;
        vec3 c;
        float m = emit(clamp(uv, 0.0, 1.0), c);
        acc += c * m * illum * weight;
        illum *= decay;
      }
      acc *= tapNorm;
      // Shafts never lighten occluders' cores harshly: soft screen blend.
      vec3 rays = acc * tint * intensity;
      // Near occluders keep their silhouette: only a thin veil of scatter on top.
      float selfFar = useDepth > 0.5 ? step(sunDepth - depthBias, linDepth(vUv)) : 1.0;
      rays *= mix(0.3, 1.0, selfFar);
      gl_FragColor = vec4(base.rgb + rays * (1.0 - base.rgb * 0.5), base.a);
    }
  `,
};

export type GodRayHandle = {
  pass: ShaderPass;
  /** Current effective intensity (0 = off). */
  readonly intensity: number;
  update: (inputs: GodRayInputs & { tone?: HealthTone }) => void;
  setSun: (sunWorld: THREE.Vector3, camera: THREE.Camera) => void;
  /**
   * Attach the scene depth texture or null for luminance-only. With EffectComposer
   * built on a target that has a DepthTexture, pass `composer.readBuffer.depthTexture`
   * (RenderPass draws into readBuffer and does not swap).
   */
  setDepthTexture: (tex: THREE.Texture | null, camera?: THREE.PerspectiveCamera) => void;
  /**
   * #109: live tap budget. Auto-fed every render from the composer readBuffer
   * size (device px) and the composer frame delta; exposed for tests / HUD.
   */
  readonly taps: number;
  readonly tapParams: GodRayTapParams;
  /** Manual override hooks (rebind / tests). */
  setBufferSize: (bufW: number, bufH: number) => number;
  sampleFrameMs: (ms: number) => number;
  dispose: () => void;
};

type GodRayUniforms = {
  [K in keyof typeof GodRayShader.uniforms]: { value: (typeof GodRayShader.uniforms)[K]["value"] };
};

export function createGodRayPass(
  init: Partial<GodRayInputs> = {},
  budgetOpts: GodRayBudgetOpts & { adaptive?: boolean } = {},
): GodRayHandle {
  const pass = new ShaderPass(GodRayShader);
  const u = pass.uniforms as unknown as GodRayUniforms;
  // ShaderPass clones uniforms; make sure Vector2/Color are per-instance.
  u.sunUv.value = new THREE.Vector2(0.5, 0.5);
  u.tint.value = new THREE.Color(...KEY_RGB.healthy);
  let base = godRayIntensity({ healthy: 0, total: 0, reducedMotion: false, ...init });
  let fade = 1;
  /** Sticky depth from setDepthTexture; rebound per-frame from active readBuffer when possible. */
  let depthTex: THREE.Texture | null = null;
  let depthCam: THREE.PerspectiveCamera | null = null;
  const apply = () => {
    const eff = base * fade;
    u.intensity.value = eff;
    pass.enabled = eff > 0.001;
  };
  apply();
  const adaptive = budgetOpts.adaptive !== false;
  const budget = createGodRayBudget(budgetOpts);
  const applyTaps = (p: GodRayTapParams) => {
    u.taps.value = p.taps;
    u.decay.value = p.decay;
    u.tapNorm.value = p.norm;
  };
  applyTaps(godRayTapParams(GOD_RAY_MAX_TAPS));
  let lastBufW = -1;
  let lastBufH = -1;
  let disposed = false;
  // HACKER: WebGL feedback loop — sampling a DepthTexture still attached to an FBO that a
  // later composer pass (or the next swap) renders into. Bind depth from the *current*
  // readBuffer at render time, then unbind so bloom/grade/painterly write-targets stay clean.
  const baseRender = pass.render.bind(pass);
  pass.render = ((renderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
    if (disposed) return;
    if (adaptive) {
      // Live drawing-buffer size of the frame we are about to shade (device px):
      // follows composer.setPixelRatio / setSize with no extra wiring.
      const rb = readBuffer as THREE.WebGLRenderTarget | undefined;
      const bw = rb?.width ?? 0;
      const bh = rb?.height ?? 0;
      if (bw !== lastBufW || bh !== lastBufH) {
        lastBufW = bw;
        lastBufH = bh;
        budget.setBuffer(bw, bh);
      }
      // EffectComposer passes seconds; ignore junk (handled in budget).
      budget.sampleFrame(Number(deltaTime) * 1000);
      applyTaps(budget.params);
    }
    const liveDepth = liveSceneDepth(renderer, readBuffer as THREE.WebGLRenderTarget, depthTex);
    u.tDepth.value = liveDepth;
    u.useDepth.value = liveDepth ? 1 : 0;
    if (depthCam) {
      u.cameraNear.value = depthCam.near;
      u.cameraFar.value = depthCam.far;
    }
    baseRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    if (!pass.renderToScreen) markDepthClobbered(renderer, writeBuffer);
    u.tDepth.value = null;
    u.useDepth.value = 0;
  }) as typeof pass.render;
  return {
    pass,
    get intensity() {
      return disposed ? 0 : u.intensity.value;
    },
    get taps() {
      return u.taps.value;
    },
    get tapParams() {
      return { taps: u.taps.value, decay: u.decay.value, norm: u.tapNorm.value };
    },
    setBufferSize(bufW, bufH) {
      if (disposed) return u.taps.value;
      lastBufW = bufW;
      lastBufH = bufH;
      budget.setBuffer(bufW, bufH);
      applyTaps(budget.params);
      return u.taps.value;
    },
    sampleFrameMs(ms) {
      if (disposed) return u.taps.value;
      budget.sampleFrame(ms);
      applyTaps(budget.params);
      return u.taps.value;
    },
    update(inputs) {
      if (disposed) return;
      base = godRayIntensity(inputs);
      if (inputs.tone !== undefined) {
        u.tint.value.setRGB(...KEY_RGB[normalizeHealthTone(inputs.tone)]);
      }
      apply();
    },
    setSun(sunWorld, camera) {
      if (disposed) return;
      const s = sunScreenUv(sunWorld, camera);
      u.sunUv.value.set(s.uv[0], s.uv[1]);
      fade = s.visible ? s.edgeFade : 0;
      u.sunDepth.value = s.depth;
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera) {
        u.cameraNear.value = cam.near;
        u.cameraFar.value = cam.far;
      }
      apply();
    },
    setDepthTexture(tex, camera) {
      if (disposed) return;
      depthTex = tex;
      // Do not leave tDepth bound between frames — render() rebinds from readBuffer.
      u.tDepth.value = null;
      u.useDepth.value = 0;
      if (camera) {
        depthCam = camera;
        u.cameraNear.value = camera.near;
        u.cameraFar.value = camera.far;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      u.tDepth.value = null;
      u.useDepth.value = 0;
      u.intensity.value = 0;
      pass.enabled = false;
      pass.dispose();
    },
  };
}
