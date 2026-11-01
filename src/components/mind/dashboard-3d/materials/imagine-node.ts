import * as THREE from "three";
import { ImagineNodeShader } from "../shaders/imagine-node.ts";
import {
  sanitizeFinite,
  sanitizeShaderTime,
  GPU_SAFE_TEXTURE_DEFAULT,
  PAPER_GRAIN_MIN_SIZE,
} from "./paper-grain.ts";
import { PAINTER_SHADER_PRECISION } from "../shaders/glsl-noise.ts";

export type ImagineNodeOptions = {
  /** Imagine-generated Texture (portrait/character/scene). Null/undefined → wash fallback. */
  map?: THREE.Texture | null;
  /** Shared paper-grain DataTexture from the painter kit (optional). */
  paperMap?: THREE.Texture | null;
  accent?: THREE.ColorRepresentation;
  wash?: THREE.ColorRepresentation;
  grain?: number;
  bleed?: number;
  frame?: number;
  opacity?: number;
  /** From gl.MAX_TEXTURE_SIZE; omit → mobile-safe default. */
  maxTextureSize?: number;
};

export type ImagineTextureSanitizeOptions = {
  maxTextureSize?: number;
  /** Attempt canvas downscale when over GPU max (skipped if tainted / no DOM). */
  allowDownscale?: boolean;
};

export type ImagineTextureSanitizeResult = {
  ok: boolean;
  texture: THREE.Texture | null;
  reason: string | null;
  width: number;
  height: number;
  npot: boolean;
  downscaled: boolean;
  /** True when result.texture is a NEW texture we created (caller must dispose). */
  owned: boolean;
};

/** Soft cap edge for Imagine maps (also clamped to GPU max). */
export const IMAGINE_IMAGE_MIN_EDGE = PAPER_GRAIN_MIN_SIZE;
export const IMAGINE_IMAGE_HARD_MAX = 8192;

function cloneUniforms(src: typeof ImagineNodeShader.uniforms) {
  return {
    uImage: { value: null as THREE.Texture | null },
    uPaperMap: { value: null as THREE.Texture | null },
    uHasImage: { value: 0 },
    uHasPaper: { value: 0 },
    uAccent: {
      value: new THREE.Color(src.uAccent.value[0], src.uAccent.value[1], src.uAccent.value[2]),
    },
    uWash: {
      value: new THREE.Color(src.uWash.value[0], src.uWash.value[1], src.uWash.value[2]),
    },
    uTime: { value: 0 },
    uGrain: { value: src.uGrain.value as number },
    uBleed: { value: src.uBleed.value as number },
    uFrame: { value: src.uFrame.value as number },
    uOpacity: { value: src.uOpacity.value as number },
  };
}

/** Read width/height from Texture.image / DataTexture (NaN/missing → 0). */
export function readTextureImageSize(tex: THREE.Texture | null | undefined): {
  width: number;
  height: number;
} {
  if (!tex) return { width: 0, height: 0 };
  const img = tex.image as
    | {
        width?: number;
        height?: number;
        naturalWidth?: number;
        naturalHeight?: number;
        videoWidth?: number;
        videoHeight?: number;
      }
    | undefined;
  if (!img || typeof img !== "object") return { width: 0, height: 0 };
  const w = Number(img.width ?? img.naturalWidth ?? img.videoWidth ?? 0);
  const h = Number(img.height ?? img.naturalHeight ?? img.videoHeight ?? 0);
  return {
    width: Number.isFinite(w) ? Math.floor(w) : 0,
    height: Number.isFinite(h) ? Math.floor(h) : 0,
  };
}

export function isPowerOfTwoSize(n: number): boolean {
  return Number.isFinite(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * Probe whether drawing the image would taint the canvas (cross-origin without CORS).
 * Without DOM, returns false (cannot probe) — caller still gets size checks.
 */
export function isImageSourceTainted(image: unknown): boolean {
  if (typeof document === "undefined" || !image || typeof image !== "object") return false;
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext("2d");
    if (!ctx) return true;
    ctx.drawImage(image as CanvasImageSource, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
    return false;
  } catch {
    return true;
  }
}

function applyNpotSafeFilters(tex: THREE.Texture): void {
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
}

function tryDownscaleTexture(
  tex: THREE.Texture,
  maxEdge: number,
): { texture: THREE.Texture; width: number; height: number } | null {
  if (typeof document === "undefined") return null;
  const { width: w0, height: h0 } = readTextureImageSize(tex);
  if (w0 < 1 || h0 < 1) return null;
  if (isImageSourceTainted(tex.image)) return null;
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(IMAGINE_IMAGE_MIN_EDGE, Math.floor(w0 * scale));
  const h = Math.max(IMAGINE_IMAGE_MIN_EDGE, Math.floor(h0 * scale));
  try {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(tex.image as CanvasImageSource, 0, 0, w, h);
    const out = new THREE.CanvasTexture(c);
    out.colorSpace = tex.colorSpace ?? THREE.SRGBColorSpace;
    applyNpotSafeFilters(out);
    out.needsUpdate = true;
    return { texture: out, width: w, height: h };
  } catch {
    return null;
  }
}

/**
 * HACKER (c5): validate Imagine textures before binding.
 * Rejects NaN/0/negative/hostile dims; clamps to MAX_TEXTURE_SIZE; NPOT → no mipmaps;
 * cross-origin-tainted → refuse bind (wash fallback) with an explicit reason (never silent).
 */
export function sanitizeImagineImageTexture(
  tex: THREE.Texture | null | undefined,
  opts: ImagineTextureSanitizeOptions = {},
): ImagineTextureSanitizeResult {
  if (tex == null) {
    return {
      ok: false,
      texture: null,
      reason: "missing",
      width: 0,
      height: 0,
      npot: false,
      downscaled: false,
      owned: false,
    };
  }
  let { width, height } = readTextureImageSize(tex);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return {
      ok: false,
      texture: null,
      reason: "invalid-dimensions",
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0,
      npot: false,
      downscaled: false,
      owned: false,
    };
  }
  if (width > IMAGINE_IMAGE_HARD_MAX || height > IMAGINE_IMAGE_HARD_MAX) {
    return {
      ok: false,
      texture: null,
      reason: "dimensions-exceed-hard-max",
      width,
      height,
      npot: !isPowerOfTwoSize(width) || !isPowerOfTwoSize(height),
      downscaled: false,
      owned: false,
    };
  }

  // if source exceeds GPU max → downscale or reject
  const gpuMax =
    opts.maxTextureSize != null && Number.isFinite(opts.maxTextureSize) && opts.maxTextureSize >= IMAGINE_IMAGE_MIN_EDGE
      ? Math.min(IMAGINE_IMAGE_HARD_MAX, Math.floor(opts.maxTextureSize))
      : GPU_SAFE_TEXTURE_DEFAULT;

  let owned = false;
  let downscaled = false;
  let out: THREE.Texture = tex;

  if (width > gpuMax || height > gpuMax) {
    if (opts.allowDownscale !== false) {
      const d = tryDownscaleTexture(tex, gpuMax);
      if (d) {
        out = d.texture;
        width = d.width;
        height = d.height;
        owned = true;
        downscaled = true;
      } else {
        return {
          ok: false,
          texture: null,
          reason: "exceeds-max-texture-size",
          width,
          height,
          npot: !isPowerOfTwoSize(width) || !isPowerOfTwoSize(height),
          downscaled: false,
          owned: false,
        };
      }
    } else {
      return {
        ok: false,
        texture: null,
        reason: "exceeds-max-texture-size",
        width,
        height,
        npot: !isPowerOfTwoSize(width) || !isPowerOfTwoSize(height),
        downscaled: false,
        owned: false,
      };
    }
  }

  // Taint check (cross-origin without CORS) — wash fallback + explicit error
  if (isImageSourceTainted(out.image)) {
    if (owned) {
      try {
        out.dispose();
      } catch {
        /* */
      }
    }
    return {
      ok: false,
      texture: null,
      reason: "cross-origin-tainted",
      width,
      height,
      npot: !isPowerOfTwoSize(width) || !isPowerOfTwoSize(height),
      downscaled,
      owned: false,
    };
  }

  const npot = !isPowerOfTwoSize(width) || !isPowerOfTwoSize(height);
  if (npot) applyNpotSafeFilters(out);
  out.needsUpdate = true;

  return {
    ok: true,
    texture: out,
    reason: null,
    width,
    height,
    npot,
    downscaled,
    owned,
  };
}

/**
 * Painterly ShaderMaterial for Imagine people/characters/scenes on universe nodes.
 * Safe when the image is missing or still loading (procedural wash). Does NOT
 * dispose the caller's image Texture — only owned downscales + the material itself.
 * Load/sanitize failures are recorded on mat.userData.imagineMapError (never silent).
 */
export function createImagineNodeMaterial(opts: ImagineNodeOptions = {}): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(ImagineNodeShader.uniforms);
  if (opts.accent != null) uniforms.uAccent.value.set(opts.accent);
  if (opts.wash != null) uniforms.uWash.value.set(opts.wash);
  if (opts.grain != null) uniforms.uGrain.value = sanitizeFinite(opts.grain, 0.28, 0, 1);
  if (opts.bleed != null) uniforms.uBleed.value = sanitizeFinite(opts.bleed, 0.55, 0, 1);
  if (opts.frame != null) uniforms.uFrame.value = sanitizeFinite(opts.frame, 0.72, 0, 1);
  if (opts.opacity != null) uniforms.uOpacity.value = sanitizeFinite(opts.opacity, 0.95, 0, 1);
  const mat = new THREE.ShaderMaterial({
    name: "ImagineNodeMaterial",
    precision: PAINTER_SHADER_PRECISION,
    uniforms,
    vertexShader: ImagineNodeShader.vertexShader,
    fragmentShader: ImagineNodeShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  (mat.userData as Record<string, unknown>).painterSlots = { paperMap: "uPaperMap" };
  (mat.userData as Record<string, unknown>).imagineMapError = null;
  (mat.userData as Record<string, unknown>).imagineOwnedMap = null;
  (mat.userData as Record<string, unknown>).maxTextureSize = opts.maxTextureSize;
  (mat.userData as Record<string, unknown>).imagineReleased = false;
  (mat.userData as Record<string, unknown>).imagineGeneration = 0;
  setImagineNodePaperMap(mat, opts.paperMap ?? null);
  setImagineNodeMap(mat, opts.map ?? null, { maxTextureSize: opts.maxTextureSize });
  return mat;
}

function disposeOwnedImagineMap(mat: THREE.ShaderMaterial): void {
  const owned = (mat.userData as Record<string, unknown>).imagineOwnedMap as THREE.Texture | null;
  if (owned) {
    try {
      owned.dispose();
    } catch {
      /* */
    }
    (mat.userData as Record<string, unknown>).imagineOwnedMap = null;
  }
}

/**
 * Bind / clear the Imagine image after sanitize.
 * On failure: wash fallback (uHasImage=0) AND mat.userData.imagineMapError set (not hidden).
 * Never disposes the caller's original Texture; disposes prior owned downscales.
 */
/** True when material was released/disposed — late TextureLoader callbacks must no-op. */
export function isImagineNodeReleased(mat: THREE.ShaderMaterial): boolean {
  if ((mat as { disposed?: boolean }).disposed) return true;
  return !!(mat.userData as Record<string, unknown>).imagineReleased;
}

/** Mark released so async portrait loads cannot rebind / allocate owned downscales. */
export function markImagineNodeReleased(mat: THREE.ShaderMaterial): void {
  (mat.userData as Record<string, unknown>).imagineReleased = true;
  const gen = Number((mat.userData as Record<string, unknown>).imagineGeneration ?? 0);
  (mat.userData as Record<string, unknown>).imagineGeneration = (Number.isFinite(gen) ? gen : 0) + 1;
}

export function setImagineNodeMap(
  mat: THREE.ShaderMaterial,
  map: THREE.Texture | null | undefined,
  opts: ImagineTextureSanitizeOptions = {},
): ImagineTextureSanitizeResult {
  // HACKER (c9): race — TextureLoader may finish after rebuild released this material.
  // Must not write uniforms or allocate owned downscales onto a dead material.
  if (isImagineNodeReleased(mat)) {
    return {
      ok: false,
      texture: null,
      reason: "material-released",
      width: 0,
      height: 0,
      npot: false,
      downscaled: false,
      owned: false,
    };
  }
  if (!mat.uniforms?.["uImage"] || !mat.uniforms?.["uHasImage"]) {
    return {
      ok: false,
      texture: null,
      reason: "material-missing-uniforms",
      width: 0,
      height: 0,
      npot: false,
      downscaled: false,
      owned: false,
    };
  }
  disposeOwnedImagineMap(mat);
  const maxTextureSize =
    opts.maxTextureSize ??
    ((mat.userData as Record<string, unknown>).maxTextureSize as number | undefined);
  const result = sanitizeImagineImageTexture(map, { ...opts, maxTextureSize });
  if (!result.ok || !result.texture) {
    mat.uniforms["uImage"].value = null;
    mat.uniforms["uHasImage"].value = 0;
    (mat.userData as Record<string, unknown>).imagineMapError = result.reason ?? "rejected";
    return result;
  }
  // Re-check after sanitize/downscale — release may have won the race mid-flight.
  if (isImagineNodeReleased(mat)) {
    if (result.owned) {
      try { result.texture.dispose(); } catch { /* */ }
    }
    return {
      ok: false,
      texture: null,
      reason: "material-released",
      width: result.width,
      height: result.height,
      npot: result.npot,
      downscaled: result.downscaled,
      owned: false,
    };
  }
  mat.uniforms["uImage"].value = result.texture;
  mat.uniforms["uHasImage"].value = 1;
  (mat.userData as Record<string, unknown>).imagineMapError = null;
  if (result.owned) {
    (mat.userData as Record<string, unknown>).imagineOwnedMap = result.texture;
  }
  return result;
}

/** Bind / clear shared paper-grain. Null falls back to procedural grain in-shader. */
export function setImagineNodePaperMap(
  mat: THREE.ShaderMaterial,
  paper: THREE.Texture | null | undefined,
): void {
  if (!mat.uniforms?.["uPaperMap"] || !mat.uniforms?.["uHasPaper"]) return;
  const tex = paper ?? null;
  mat.uniforms["uPaperMap"].value = tex;
  mat.uniforms["uHasPaper"].value = tex ? 1 : 0;
}

export function tickImagineNodeMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
}

/** Dispose owned downscale maps attached to an Imagine material (idempotent). */
export function disposeImagineNodeOwnedMaps(mat: THREE.ShaderMaterial): void {
  disposeOwnedImagineMap(mat);
}
