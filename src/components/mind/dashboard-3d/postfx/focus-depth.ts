import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { liveSceneDepth, markDepthClobbered } from "./depth-validity.ts";
import { linearDepthOf, sunScreenUv } from "./god-rays.ts";

/**
 * Depth-aware focus falloff (light lane, cycle "focus readability").
 *
 * While a node is focused, pixels outside its depth band lose a little
 * contrast/saturation and drift toward the fog colour (atmospheric
 * perspective), so the focused star, its Imagine portrait card and the DOM
 * detail card / charts on top read against a calmer background. The focused
 * band stays untouched (weight 0). With no depth texture it falls back to a
 * soft radial falloff around the focus point's screen position.
 *
 * Off (pass.enabled = false, zero cost) with no focus, a focus behind the
 * camera, or non-finite input. Reduced motion snaps instead of easing.
 * Place after god-rays and BEFORE bloom so dimmed background doesn't bloom.
 */

export const FOCUS_DEPTH_EASE_MS = 350;
/** Max background mute (0..1). Kept low so context stays legible. */
export const FOCUS_DEPTH_MAX = 0.42;
/** Half-width of the crisp band in linear depth (0..1 of near..far). */
export const FOCUS_BAND = 0.035;
/** Extra linear depth over which falloff ramps to full. */
export const FOCUS_RAMP = 0.12;

/** JS mirror of the shader band weight: 0 inside band → 1 past band+ramp. Junk → 0. */
export function focusBandWeight(
  depth: number,
  focusDepth: number,
  band = FOCUS_BAND,
  ramp = FOCUS_RAMP,
): number {
  if (![depth, focusDepth, band, ramp].every(Number.isFinite) || ramp <= 0) return 0;
  const d = Math.abs(depth - focusDepth);
  const t = Math.min(1, Math.max(0, (d - Math.max(0, band)) / ramp));
  return t * t * (3 - 2 * t);
}

export const FocusDepthShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    useDepth: { value: 0 },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    focusDepth: { value: 0.5 },
    focusUv: { value: new THREE.Vector2(0.5, 0.5) },
    aspect: { value: 1 },
    band: { value: FOCUS_BAND },
    ramp: { value: FOCUS_RAMP },
    strength: { value: 0 },
    fogColor: { value: new THREE.Color(0x050814) },
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
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float useDepth;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float focusDepth;
    uniform vec2 focusUv;
    uniform float aspect;
    uniform float band;
    uniform float ramp;
    uniform float strength;
    uniform vec3 fogColor;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (strength <= 0.0) { gl_FragColor = base; return; }
      float w;
      if (useDepth > 0.5) {
        float fragZ = texture2D(tDepth, vUv).x;
        float viewZ = perspectiveDepthToViewZ(fragZ, cameraNear, cameraFar);
        float lin = viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
        w = smoothstep(0.0, 1.0, clamp((abs(lin - focusDepth) - band) / ramp, 0.0, 1.0));
      } else {
        vec2 d = (vUv - focusUv) * vec2(aspect, 1.0);
        w = smoothstep(0.18, 0.62, length(d));
      }
      w *= strength;
      vec3 c = base.rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, vec3(l), w * 0.55);          // desaturate
      c = mix(c, vec3(l) * 0.5 + c * 0.5, w * 0.25); // flatten contrast toward luma
      c = mix(c, fogColor, w * 0.35);          // atmospheric perspective
      gl_FragColor = vec4(c, base.a);
    }
  `,
};

type FocusDepthUniforms = {
  [K in keyof typeof FocusDepthShader.uniforms]: { value: (typeof FocusDepthShader.uniforms)[K]["value"] };
};

export type FocusDepthHandle = {
  pass: ShaderPass;
  /** Effective strength (0 = off). */
  readonly strength: number;
  /** Focus a world point (null = clear). Camera supplies projection + depth range. */
  setFocus: (world: THREE.Vector3 | null, camera: THREE.Camera, opts?: { reducedMotion?: boolean }) => void;
  setFogColor: (hex: number) => void;
  /** Sticky fallback depth texture; render() prefers the live readBuffer depth. */
  setDepthTexture: (tex: THREE.Texture | null) => void;
  tick: (dtMs: number) => void;
  dispose: () => void;
};

export function createFocusDepthPass(): FocusDepthHandle {
  const pass = new ShaderPass(FocusDepthShader);
  const u = pass.uniforms as unknown as FocusDepthUniforms;
  u.focusUv.value = new THREE.Vector2(0.5, 0.5);
  u.fogColor.value = new THREE.Color(0x050814);
  let disposed = false;
  let level = 0;
  let target = 0;
  let from = 0;
  let elapsed = FOCUS_DEPTH_EASE_MS;
  let reduced = false;
  let depthTex: THREE.Texture | null = null;

  const apply = () => {
    u.strength.value = FOCUS_DEPTH_MAX * level;
    pass.enabled = !disposed && u.strength.value > 0.001;
  };
  apply();

  // Same feedback-loop guard as god-rays: bind depth from the current readBuffer
  // only for this draw, then unbind so later passes' FBOs never sample it.
  const baseRender = pass.render.bind(pass);
  pass.render = ((renderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
    if (disposed) return;
    // HACKER: after god-rays swaps, readBuffer depth is the quad's flat depth —
    // never sample it (whole frame incl. focused card would mute). Radial instead.
    const live = liveSceneDepth(renderer, readBuffer as THREE.WebGLRenderTarget, depthTex);
    u.tDepth.value = live;
    u.useDepth.value = live ? 1 : 0;
    const w = (readBuffer as THREE.WebGLRenderTarget | undefined)?.width ?? 1;
    const h = (readBuffer as THREE.WebGLRenderTarget | undefined)?.height ?? 1;
    u.aspect.value = w > 0 && h > 0 ? w / h : 1;
    baseRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    if (!pass.renderToScreen) markDepthClobbered(renderer, writeBuffer);
    u.tDepth.value = null;
    u.useDepth.value = 0;
  }) as typeof pass.render;

  return {
    pass,
    get strength() {
      return disposed ? 0 : u.strength.value;
    },
    setFocus(world, camera, opts = {}) {
      if (disposed) return;
      reduced = !!opts.reducedMotion;
      let next = 0;
      if (world && [world.x, world.y, world.z].every(Number.isFinite)) {
        camera.updateMatrixWorld();
        const s = sunScreenUv(world, camera);
        if (s.visible) {
          next = 1;
          u.focusUv.value.set(s.uv[0], s.uv[1]);
          u.focusDepth.value = linearDepthOf(world, camera);
          const cam = camera as THREE.PerspectiveCamera;
          if (cam.isPerspectiveCamera) {
            u.cameraNear.value = cam.near;
            u.cameraFar.value = cam.far;
          }
        }
      }
      if (next !== target) {
        from = level;
        target = next;
        elapsed = 0;
      }
      if (reduced) {
        level = target;
        elapsed = FOCUS_DEPTH_EASE_MS;
      }
      apply();
    },
    setFogColor(hex) {
      if (disposed || !Number.isFinite(hex)) return;
      u.fogColor.value.setHex(hex);
    },
    setDepthTexture(tex) {
      if (disposed) return;
      depthTex = tex;
      u.tDepth.value = null;
      u.useDepth.value = 0;
    },
    tick(dtMs) {
      if (disposed) return;
      const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
      if (reduced || elapsed >= FOCUS_DEPTH_EASE_MS) {
        level = target;
      } else {
        elapsed = Math.min(FOCUS_DEPTH_EASE_MS, elapsed + dt);
        const t = elapsed / FOCUS_DEPTH_EASE_MS;
        level = from + (target - from) * (t * t * (3 - 2 * t));
      }
      apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      level = 0;
      u.tDepth.value = null;
      depthTex = null;
      apply();
      pass.dispose();
    },
  };
}
