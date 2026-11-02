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

/**
 * #117: UV scale from mask-texel space to full-res UV. With an odd buffer edge the
 * mask is ceil(w/2) texels wide, so mask texel i covers full-res texels [2i, 2i+2)
 * and the mask spans 2·m/w of the source, not exactly 1. Without this the 2×2
 * block centres drift up to ~1 device px across the frame (and the last column
 * is double-weighted), which moves shafts by a pixel whenever a resize flips
 * the buffer between even and odd. Even edges / junk → 1 (bit-identical).
 */
export function godRayMaskUvScale(bufW: number, bufH: number, factor: number): [number, number] {
  const [mw, mh] = godRayMaskSize(bufW, bufH, factor);
  if (mw === 0 || mh === 0) return [1, 1];
  const f = Number.isFinite(factor) && factor >= 1 ? Math.floor(factor) : 1;
  return [(mw * f) / bufW, (mh * f) / bufH];
}

type MaskRendererCaps = {
  capabilities?: { isWebGL2?: boolean };
  extensions?: { has?: (name: string) => boolean };
};

/**
 * #117: mask texel type. HalfFloat only when it can really be rendered to:
 * WebGL2 alone is not enough — RGBA16F is colour-renderable only with
 * EXT_color_buffer_float (or EXT_color_buffer_half_float). Without it three.js
 * still allocates the target, the FBO is incomplete and the mask silently reads
 * black: god rays vanish on exactly the >2.5 MP / backed-off frames #114 targets.
 * A byte source (painter c20 half-float→byte composer fallback) has no HDR to
 * keep, so the mask matches it and holds half the VRAM.
 */
export function godRayMaskType(
  renderer: MaskRendererCaps | null | undefined,
  sourceType: THREE.TextureDataType | null | undefined,
): THREE.TextureDataType {
  if (sourceType === THREE.UnsignedByteType) return THREE.UnsignedByteType;
  if (renderer?.capabilities?.isWebGL2 !== true) return THREE.UnsignedByteType;
  const has = renderer.extensions?.has;
  if (typeof has !== "function") return THREE.UnsignedByteType;
  try {
    const ext = renderer.extensions as { has: (name: string) => boolean };
    return ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float")
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;
  } catch {
    return THREE.UnsignedByteType;
  }
}

/** CPU mirror of the shader's 8-bit HDR encode / decode (tests). */
export const godRayMaskEncode = (e: number) => (e > 0 ? e / (1 + e) : 0);
export const godRayMaskDecode = (x: number) => x / Math.max(1 - x, 1 / 255);

/** Bytes per texel of the mask (RGBA) for the VRAM readout. */
export function godRayMaskBytes(w: number, h: number, type: THREE.TextureDataType | null): number {
  if (!type || !(w > 0) || !(h > 0)) return 0;
  return w * h * (type === THREE.HalfFloatType ? 8 : 4);
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
    /** #117: mask-UV → full-res UV (1 on even edges). */
    uvScale: { value: new THREE.Vector2(1, 1) },
    /** #117: 1 = store e/(1+e) (8-bit mask over an HDR source keeps sun cores > 1). */
    hdrEncode: { value: 0 },
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
    uniform vec2 uvScale;
    uniform float hdrEncode;
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
      // vUv * uvScale is the centre of a 2x2 block of full-res texels: sample each centre exactly.
      vec2 c = vUv * uvScale;
      vec2 o = 0.5 * srcTexel;
      vec3 e = emitAt(clamp(c + vec2(-o.x, -o.y), 0.0, 1.0))
             + emitAt(clamp(c + vec2( o.x, -o.y), 0.0, 1.0))
             + emitAt(clamp(c + vec2(-o.x,  o.y), 0.0, 1.0))
             + emitAt(clamp(c + vec2( o.x,  o.y), 0.0, 1.0));
      vec3 avg = e * 0.25;
      // 8-bit mask over an HDR source: Reinhard range encode so sun cores > 1 survive (#117).
      if (hdrEncode > 0.5) avg = avg / (vec3(1.0) + avg);
      gl_FragColor = vec4(avg, 1.0);
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
  /** #117: full-res UV → mask UV for the radial read (1 / uvScale; 1 on even edges). */
  readonly readScale: THREE.Vector2;
  /** #117: live mask VRAM (bytes, 0 when freed) and texel type. */
  readonly bytes: number;
  readonly type: THREE.TextureDataType | null;
  /** #117: true when the live mask stores e/(1+e) (byte mask over an HDR source). */
  readonly encoded: boolean;
  /** #117: true once a HalfFloat mask FBO came back incomplete (sticky byte fallback). */
  readonly halfFloatRejected: boolean;
  /**
   * Render the mask for this frame if taps < 48. Returns the mask texture or
   * null (stock per-tap path). Never throws on a partial renderer.
   */
  render: (
    renderer: THREE.WebGLRenderer,
    readBuffer: THREE.WebGLRenderTarget | undefined,
    taps: number,
  ) => THREE.Texture | null;
  /** #117: free the mask target now (pass disabled / context lost); material kept. */
  release: () => void;
  dispose: () => void;
};

type FramebufferGl = {
  FRAMEBUFFER: number;
  FRAMEBUFFER_COMPLETE: number;
  checkFramebufferStatus: (target: number) => number;
};

/** Status of the currently bound FBO; null when the renderer can't say (tests, partial). */
function boundFramebufferComplete(renderer: THREE.WebGLRenderer): boolean | null {
  try {
    const gl = (renderer as { getContext?: () => unknown }).getContext?.() as FramebufferGl | undefined;
    if (!gl || typeof gl.checkFramebufferStatus !== "function") return null;
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  } catch {
    return null;
  }
}

export type GodRayMaskOpts = {
  /** #117 A/B + WebGL1 parity: force an 8-bit mask even where HalfFloat renders. */
  forceByte?: boolean;
};

export function createGodRayMask(opts: GodRayMaskOpts = {}): GodRayMask {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(GodRayMaskShader.uniforms),
    vertexShader: GodRayMaskShader.vertexShader,
    fragmentShader: GodRayMaskShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const u = material.uniforms as unknown as MaskUniforms;
  u.srcTexel.value = new THREE.Vector2(1, 1);
  u.uvScale.value = new THREE.Vector2(1, 1);
  const readScale = new THREE.Vector2(1, 1);
  let halfRejected = false;
  let byteRejected = false;
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
  const api: GodRayMask = {
    get factor() {
      return factor;
    },
    get target() {
      return rt;
    },
    get bytes() {
      return rt ? godRayMaskBytes(rt.width, rt.height, rtType) : 0;
    },
    get type() {
      return rtType;
    },
    get encoded() {
      return rt !== null && u.hdrEncode.value > 0.5;
    },
    get halfFloatRejected() {
      return halfRejected;
    },
    readScale,
    uniforms: u,
    release() {
      free();
      factor = 1;
    },
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
      // HDR sun cores must survive the mask: half-float only where it is renderable (#117).
      let type = godRayMaskType(renderer as MaskRendererCaps, readBuffer.texture.type);
      if (halfRejected || opts.forceByte === true) type = THREE.UnsignedByteType;
      if (type === THREE.UnsignedByteType && byteRejected) {
        factor = 1;
        free();
        return null;
      }
      let fresh = false;
      if (!rt || rtType !== type) {
        fresh = true;
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
      u.hdrEncode.value = type === THREE.UnsignedByteType && readBuffer.texture.type !== THREE.UnsignedByteType ? 1 : 0;
      u.srcTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
      const [sx, sy] = godRayMaskUvScale(readBuffer.width, readBuffer.height, factor);
      u.uvScale.value.set(sx, sy);
      readScale.set(1 / sx, 1 / sy);
      renderer.setRenderTarget(rt);
      if (fresh && boundFramebufferComplete(renderer) === false) {
        // Silent-black guard: never sample an incomplete mask. Half → byte, byte → stock path.
        if (type === THREE.HalfFloatType) halfRejected = true;
        else byteRejected = true;
        free();
        renderer.setRenderTarget(null);
        u.tDepth.value = null;
        u.tDiffuse.value = null;
        return api.render(renderer, readBuffer, taps);
      }
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
  return api;
}
