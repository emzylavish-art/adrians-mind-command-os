import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { GOD_RAY_MAX_TAPS } from "./god-ray-budget.ts";

/**
 * Light #114 — god-ray occlusion/emission mask anti-alias under the #109 tap budget.
 *
 * Above ~2.5 MP the #109 budget drops the radial sampler to as few as 16 taps,
 * so each tap steps tens of device px. A sub-texel bright source (star core,
 * comet head, a thin occluder edge) is then hit or missed per pixel depending on
 * the dither, and the shaft shimmers as the camera orbits. Measured with the
 * CPU model in god-ray-mask.test.ts (2-px source, 4×4 px perceived window,
 * 0.1-px sweep): native 1080p/48 taps flicker 1.13, 4480×2520/16 taps 1.37.
 *
 * Fix (classic low-res occlusion buffer, GPU Gems 3 ch.13): when the live tap
 * count is below 48, the emission (bright × far-depth, rgb premultiplied) is
 * box-prefiltered once into a half-resolution target (each texel = exact 2×2
 * average of the full-res texel-centre emissions), and the radial loop reads
 * that one texture bilinearly instead of colour + depth per tap. Same model:
 * flicker 1.37 → 0.80 at 16 taps, 0.96 → 1.00 at 24 (both ≤ native), uniform-field energy unchanged. Cost
 * drops too: 2 fetches/px for the mask + 1 per tap, versus 2 per tap.
 * At 48 taps (≤ 2.5 MP, i.e. 1080p) the stock per-tap path runs unchanged.
 */

/** Downsample factor for the emission mask; 1 = stock per-tap path. */
export function godRayMaskFactor(taps: number): 1 | 2 {
  return Number.isFinite(taps) && taps > 0 && taps < GOD_RAY_MAX_TAPS ? 2 : 1;
}

/** Mask target size for a drawing buffer (device px). Junk → 0×0 (no mask). */
export function godRayMaskSize(bufW: number, bufH: number, factor: number): [number, number] {
  const w = Number.isFinite(bufW) && bufW > 0 ? bufW : 0;
  const h = Number.isFinite(bufH) && bufH > 0 ? bufH : 0;
  const f = Number.isFinite(factor) && factor >= 1 ? Math.floor(factor) : 1;
  if (w === 0 || h === 0) return [0, 0];
  return [Math.max(1, Math.ceil(w / f)), Math.max(1, Math.ceil(h / f))];
}

export const GodRayMaskShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    useDepth: { value: 0 },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    sunDepth: { value: 1 },
    depthBias: { value: 0.02 },
    lumThreshold: { value: 0.55 },
    /** 1 / full-res buffer size. */
    srcTexel: { value: new THREE.Vector2(1, 1) },
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
    uniform float sunDepth;
    uniform float depthBias;
    uniform float lumThreshold;
    uniform vec2 srcTexel;
    varying vec2 vUv;
    float linDepth(vec2 uv) {
      float fragZ = texture2D(tDepth, uv).x;
      float viewZ = perspectiveDepthToViewZ(fragZ, cameraNear, cameraFar);
      return viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
    }
    vec3 emitAt(vec2 uv) {
      vec3 col = texture2D(tDiffuse, uv).rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float bright = smoothstep(lumThreshold, lumThreshold + 0.25, l);
      float far = useDepth > 0.5 ? step(sunDepth - depthBias, linDepth(uv)) : 1.0;
      return col * bright * far;
    }
    void main() {
      // vUv is the centre of a 2x2 block of full-res texels: sample each centre exactly.
      vec2 o = 0.5 * srcTexel;
      vec3 e = emitAt(clamp(vUv + vec2(-o.x, -o.y), 0.0, 1.0))
             + emitAt(clamp(vUv + vec2( o.x, -o.y), 0.0, 1.0))
             + emitAt(clamp(vUv + vec2(-o.x,  o.y), 0.0, 1.0))
             + emitAt(clamp(vUv + vec2( o.x,  o.y), 0.0, 1.0));
      gl_FragColor = vec4(e * 0.25, 1.0);
    }
  `,
};

type MaskUniforms = {
  [K in keyof typeof GodRayMaskShader.uniforms]: { value: (typeof GodRayMaskShader.uniforms)[K]["value"] };
};

export type GodRayMask = {
  /** Factor used by the last render (1 = no mask). */
  readonly factor: number;
  readonly target: THREE.WebGLRenderTarget | null;
  readonly uniforms: MaskUniforms;
  /**
   * Render the mask for this frame if taps < 48. Returns the mask texture or
   * null (stock per-tap path). Never throws on a partial renderer.
   */
  render: (
    renderer: THREE.WebGLRenderer,
    readBuffer: THREE.WebGLRenderTarget | undefined,
    taps: number,
  ) => THREE.Texture | null;
  dispose: () => void;
};

export function createGodRayMask(): GodRayMask {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(GodRayMaskShader.uniforms),
    vertexShader: GodRayMaskShader.vertexShader,
    fragmentShader: GodRayMaskShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const u = material.uniforms as unknown as MaskUniforms;
  u.srcTexel.value = new THREE.Vector2(1, 1);
  const quad = new FullScreenQuad(material);
  let rt: THREE.WebGLRenderTarget | null = null;
  let rtType: THREE.TextureDataType | null = null;
  let factor = 1;
  let disposed = false;
  const free = () => {
    rt?.dispose();
    rt = null;
    rtType = null;
  };
  return {
    get factor() {
      return factor;
    },
    get target() {
      return rt;
    },
    uniforms: u,
    render(renderer, readBuffer, taps) {
      if (disposed) return null;
      factor = godRayMaskFactor(taps);
      const [w, h] = godRayMaskSize(readBuffer?.width ?? 0, readBuffer?.height ?? 0, factor);
      if (factor === 1 || w === 0 || !readBuffer?.texture) {
        // Stock path: release the mask so a 1080p session holds no extra VRAM.
        factor = 1;
        free();
        return null;
      }
      // HDR sun cores must survive the mask: half-float on WebGL2, byte otherwise.
      const type =
        (renderer as { capabilities?: { isWebGL2?: boolean } }).capabilities?.isWebGL2 === true
          ? THREE.HalfFloatType
          : THREE.UnsignedByteType;
      if (!rt || rtType !== type) {
        free();
        rt = new THREE.WebGLRenderTarget(w, h, {
          type,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
        });
        rtType = type;
      } else if (rt.width !== w || rt.height !== h) {
        rt.setSize(w, h);
      }
      u.tDiffuse.value = readBuffer.texture;
      u.srcTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
      renderer.setRenderTarget(rt);
      quad.render(renderer);
      // Never leave the scene depth bound on this material between frames.
      u.tDepth.value = null;
      u.tDiffuse.value = null;
      return rt.texture;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      free();
      u.tDepth.value = null;
      u.tDiffuse.value = null;
      material.dispose();
      quad.dispose();
    },
  };
}
