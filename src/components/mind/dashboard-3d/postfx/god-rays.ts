import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { KEY_RGB, normalizeHealthTone, type HealthTone } from "../atmosphere/health-tone.ts";

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

export const GOD_RAY_SAMPLES = 48;

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
    decay: { value: 0.955 },
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
      vec2 delta = (vUv - sunUv) * (density / float(SAMPLES));
      // Interleaved-gradient jitter hides the 48-step banding.
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec2 uv = vUv - delta * jitter;
      float illum = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        uv -= delta;
        vec3 c;
        float m = emit(clamp(uv, 0.0, 1.0), c);
        acc += c * m * illum * weight;
        illum *= decay;
      }
      acc /= float(SAMPLES) * 0.25;
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
  dispose: () => void;
};

type GodRayUniforms = {
  [K in keyof typeof GodRayShader.uniforms]: { value: (typeof GodRayShader.uniforms)[K]["value"] };
};

export function createGodRayPass(init: Partial<GodRayInputs> = {}): GodRayHandle {
  const pass = new ShaderPass(GodRayShader);
  const u = pass.uniforms as unknown as GodRayUniforms;
  // ShaderPass clones uniforms; make sure Vector2/Color are per-instance.
  u.sunUv.value = new THREE.Vector2(0.5, 0.5);
  u.tint.value = new THREE.Color(...KEY_RGB.healthy);
  let base = godRayIntensity({ healthy: 0, total: 0, reducedMotion: false, ...init });
  let fade = 1;
  const apply = () => {
    const eff = base * fade;
    u.intensity.value = eff;
    pass.enabled = eff > 0.001;
  };
  apply();
  let disposed = false;
  return {
    pass,
    get intensity() {
      return disposed ? 0 : u.intensity.value;
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
      u.tDepth.value = tex;
      u.useDepth.value = tex ? 1 : 0;
      if (camera) {
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
