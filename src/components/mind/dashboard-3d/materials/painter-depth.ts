import * as THREE from "three";
import { sanitizeFinite } from "./paper-grain.ts";

/**
 * Stable painter transparent stack (nebula → edges → lore → Imagine).
 * Keeps blend order deterministic when depthWrite is false.
 */
export const PAINTER_RENDER_ORDER = {
  nebula: -2,
  sky: -1,
  /** City plaza under buildings (c24). */
  ground: 0,
  star: 0,
  inkEdge: 1,
  loreBase: 2,
  imagine: 4,
  overlay: 6,
} as const;

export type LorePlaqueStackOptions = {
  /** 0 = bottom card in a star's stack; higher draws later (on top). */
  stackIndex?: number;
  /** Cap stack index so polygonOffset stays in a safe band. */
  maxStack?: number;
  /**
   * When true, enable depthWrite (opaque-ish parchment). Default false —
   * transparent plaques must not write depth or they punch holes in each other.
   */
  depthWrite?: boolean;
  /** Optional mesh to receive renderOrder. */
  mesh?: THREE.Object3D | null;
};

export type LorePlaqueStackResult = {
  stackIndex: number;
  renderOrder: number;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
  depthWrite: boolean;
  depthTest: boolean;
};

export const LORE_PLAQUE_STACK_MAX = 16;
/** Units step per stacked plaque — separates coplanar transparent cards. */
export const LORE_PLAQUE_OFFSET_UNITS = 2;
export const LORE_PLAQUE_OFFSET_FACTOR = -1;

/**
 * HACKER (c20): overlapping transparent lore plaques (all depthWrite:false,
 * same world depth) z-fight / flicker. polygonOffset + distinct renderOrder
 * make them read as layered paper without writing depth (which would clip peers).
 * Honest no-op when mat is null/disposed.
 */
export function applyLorePlaqueStackLayer(
  mat: THREE.ShaderMaterial | null | undefined,
  opts: LorePlaqueStackOptions = {},
): LorePlaqueStackResult | null {
  if (!mat || (mat as { disposed?: boolean }).disposed) return null;
  const maxStack = Math.max(
    1,
    Math.min(64, Math.floor(sanitizeFinite(opts.maxStack ?? LORE_PLAQUE_STACK_MAX, LORE_PLAQUE_STACK_MAX, 1, 64))),
  );
  const raw = opts.stackIndex == null ? 0 : opts.stackIndex;
  const stackIndex = Math.max(0, Math.min(maxStack - 1, Math.floor(sanitizeFinite(raw, 0, 0, maxStack))));
  const depthWrite = opts.depthWrite === true;
  // Negative units pull toward camera in three's polygonOffset convention for this use
  const polygonOffsetFactor = LORE_PLAQUE_OFFSET_FACTOR;
  const polygonOffsetUnits = -LORE_PLAQUE_OFFSET_UNITS * (stackIndex + 1);
  const renderOrder = PAINTER_RENDER_ORDER.loreBase + stackIndex;

  mat.transparent = true;
  mat.depthWrite = depthWrite;
  mat.depthTest = true;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = polygonOffsetFactor;
  mat.polygonOffsetUnits = polygonOffsetUnits;
  // Stable painterly paper sort — avoid CustomBlending flicker with nebula/edges
  mat.blending = THREE.NormalBlending;
  mat.needsUpdate = true;

  (mat.userData as Record<string, unknown>).loreStackIndex = stackIndex;
  (mat.userData as Record<string, unknown>).loreStackMeta = {
    renderOrder,
    polygonOffsetFactor,
    polygonOffsetUnits,
    depthWrite,
  };

  if (opts.mesh) {
    opts.mesh.renderOrder = renderOrder;
    (opts.mesh.userData as Record<string, unknown>).loreStackIndex = stackIndex;
  }

  return {
    stackIndex,
    renderOrder,
    polygonOffset: true,
    polygonOffsetFactor,
    polygonOffsetUnits,
    depthWrite,
    depthTest: true,
  };
}

/**
 * Apply painter lane renderOrder + depthWrite:false for transparent layers
 * (ink edges, nebulae) so they do not fight lore/Imagine cards.
 */
export function applyPainterTransparentLayer(
  mat: THREE.Material | null | undefined,
  layer: keyof typeof PAINTER_RENDER_ORDER,
  mesh?: THREE.Object3D | null,
): void {
  if (!mat || (mat as { disposed?: boolean }).disposed) return;
  const order = PAINTER_RENDER_ORDER[layer];
  if ("depthWrite" in mat) (mat as THREE.Material & { depthWrite: boolean }).depthWrite = false;
  if ("transparent" in mat) (mat as THREE.Material & { transparent: boolean }).transparent = true;
  if (mesh) mesh.renderOrder = order;
  (mat.userData as Record<string, unknown>).painterRenderOrder = order;
}

/**
 * HACKER (c20): custom ShaderMaterials under renderer.logarithmicDepthBuffer
 * omit logdepthbuf chunks → broken depth / fight. Patch once via onBeforeCompile.
 */
export function applyPainterLogDepthSupport(mat: THREE.ShaderMaterial | null | undefined): boolean {
  if (!mat || (mat as { disposed?: boolean }).disposed) return false;
  if ((mat.userData as Record<string, unknown>).painterLogDepthPatched) return true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === "function") prev(shader, renderer);
    if (!shader.vertexShader.includes("logdepthbuf_vertex")) {
      if (!shader.vertexShader.includes("logdepthbuf_pars_vertex")) {
        shader.vertexShader = shader.vertexShader.replace(
          "void main()",
          "#include <logdepthbuf_pars_vertex>\nvoid main()",
        );
      }
      // After last gl_Position assignment
      const vp = shader.vertexShader;
      const idx = vp.lastIndexOf("gl_Position");
      if (idx >= 0) {
        const semi = vp.indexOf(";", idx);
        if (semi >= 0 && !vp.includes("logdepthbuf_vertex")) {
          shader.vertexShader =
            vp.slice(0, semi + 1) + "\n#include <logdepthbuf_vertex>\n" + vp.slice(semi + 1);
        }
      }
    }
    if (!shader.fragmentShader.includes("logdepthbuf_fragment")) {
      if (!shader.fragmentShader.includes("logdepthbuf_pars_fragment")) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "void main()",
          "#include <logdepthbuf_pars_fragment>\nvoid main()",
        );
      }
      if (!shader.fragmentShader.includes("logdepthbuf_fragment")) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "void main() {",
          "void main() {\n#include <logdepthbuf_fragment>",
        );
      }
    }
  };
  mat.needsUpdate = true;
  (mat.userData as Record<string, unknown>).painterLogDepthPatched = true;
  return true;
}

export type PainterlyRenderTargetTypeOpts = {
  /** Probe: when false, HalfFloat unsupported (or MSAA+half-float mismatch). */
  halfFloatSupported?: boolean;
  /** Force byte RT (tests / known-bad GPUs). */
  forceUnsignedByte?: boolean;
  /** Prefer half-float when supported (default true). */
  preferHalfFloat?: boolean;
};

export type PainterlyRenderTargetTypeResult = {
  type: THREE.TextureDataType;
  halfFloat: boolean;
  reason: string | null;
};

/**
 * HACKER (c20): EffectComposer / painterly pass RTs default to HalfFloatType;
 * some contexts (SwiftShader, MSAA + half-float) fail → black post-pass.
 * Resolve UnsignedByteType fallback explicitly (never silent).
 */
export function resolvePainterlyRenderTargetType(
  opts: PainterlyRenderTargetTypeOpts = {},
): PainterlyRenderTargetTypeResult {
  if (opts.forceUnsignedByte) {
    return { type: THREE.UnsignedByteType, halfFloat: false, reason: "forceUnsignedByte" };
  }
  const prefer = opts.preferHalfFloat !== false;
  const supported = opts.halfFloatSupported !== false;
  if (prefer && supported) {
    return { type: THREE.HalfFloatType, halfFloat: true, reason: null };
  }
  return {
    type: THREE.UnsignedByteType,
    halfFloat: false,
    reason: prefer ? "half-float-unsupported" : "prefer-byte",
  };
}

/** Probe WebGL for color_buffer_half_float / EXT_color_buffer_half_float. */
export function probeHalfFloatRenderTargetSupport(
  gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined,
): boolean {
  if (!gl) return false;
  try {
    if (typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext) {
      // WebGL2: check EXT_color_buffer_float or color-renderable half float
      const ext = gl.getExtension("EXT_color_buffer_float");
      return !!ext;
    }
    const ext =
      gl.getExtension("EXT_color_buffer_half_float") ||
      gl.getExtension("OES_texture_half_float") ||
      gl.getExtension("OES_texture_half_float_linear");
    return !!ext;
  } catch {
    return false;
  }
}
