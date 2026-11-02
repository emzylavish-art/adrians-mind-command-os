import type * as THREE from "three";

/**
 * Light #107 — god-ray / bloom DPR resize rebind.
 *
 * EffectComposer caches `renderer.getPixelRatio()` at construction and only
 * changes it via `composer.setPixelRatio()`. universe-scene's onResize calls
 * `composer.setSize(cssW, cssH)` (and dedupes on CSS size only), so a browser
 * zoom or a drag to a monitor with a different devicePixelRatio leaves the
 * composer read/write targets — including the scene DepthTexture that
 * god-rays / focus-depth / focus-bloom-guard sample — at the first-frame DPR,
 * while bloom is re-sized at the new DPR. Shafts and focus guards then read a
 * mis-scaled, soft depth buffer until a full postfx rebuild.
 *
 * Also: the composer is built on a device-px render target, so its internal
 * `_width` starts in device px and every `addPass` sizes passes at css×dpr²
 * until the first CSS-px `setSize`. Calling `rebind.force()` right after the
 * composer is built (before addPass) avoids that oversize.
 *
 * This module is pure / renderer-agnostic so it runs under node:test.
 */

/** Same cap universe-scene uses for renderer.setPixelRatio. */
export const POSTFX_MAX_DPR = 1.75;
/** Floor so a junk / extreme zoom-out DPR never collapses buffers. */
export const POSTFX_MIN_DPR = 0.25;

export type PostfxViewport = {
  /** CSS (logical) pixels. */
  cssW: number;
  cssH: number;
  /** Clamped device pixel ratio actually applied. */
  dpr: number;
  /** Drawing-buffer (device) pixels = round(css × dpr). */
  bufW: number;
  bufH: number;
};

export type ViewportChange = "none" | "size" | "dpr" | "both";

const cssEdge = (v: number) => (Number.isFinite(v) && v >= 1 ? Math.round(v) : 1);

/** Smallest GPU max texture/renderbuffer edge WebGL2 guarantees. */
export const WEBGL2_MIN_MAX_EDGE = 2048;

/**
 * CSS + drawing-buffer size for the postfx chain. Junk → 1×1 @ DPR 1.
 *
 * HACKER (light c108): `maxEdge` = GPU max texture size. A window spanning two
 * 4K monitors (7680 CSS px) at DPR 2 asked for a 13440-px-wide buffer; the
 * browser silently clamps the canvas drawing buffer but EffectComposer's
 * read/write targets + scene DepthTexture were allocated at the full size →
 * texImage2D INVALID_VALUE / incomplete FBO → black or garbage frame with no
 * error surfaced. With `maxEdge`, DPR is lowered so both edges fit.
 */
export function postfxViewport(
  cssW: number,
  cssH: number,
  rawDpr: number,
  maxDpr: number = POSTFX_MAX_DPR,
  maxEdge?: number | null,
): PostfxViewport {
  const w = cssEdge(cssW);
  const h = cssEdge(cssH);
  const cap = Number.isFinite(maxDpr) && maxDpr > 0 ? maxDpr : POSTFX_MAX_DPR;
  let dpr =
    Number.isFinite(rawDpr) && rawDpr > 0
      ? Math.min(cap, Math.max(POSTFX_MIN_DPR, rawDpr))
      : 1;
  const edge =
    maxEdge != null && Number.isFinite(maxEdge) && maxEdge >= WEBGL2_MIN_MAX_EDGE ? Math.floor(maxEdge) : null;
  if (edge !== null) {
    const fit = edge / Math.max(w, h);
    if (dpr > fit) dpr = fit; // may drop below POSTFX_MIN_DPR: a valid FBO beats a sharp one
  }
  let bufW = Math.max(1, Math.round(w * dpr));
  let bufH = Math.max(1, Math.round(h * dpr));
  if (edge !== null) {
    bufW = Math.min(edge, bufW);
    bufH = Math.min(edge, bufH);
  }
  return { cssW: w, cssH: h, dpr, bufW, bufH };
}

export function viewportChange(prev: PostfxViewport | null | undefined, next: PostfxViewport): ViewportChange {
  if (!prev) return "both";
  const size = prev.cssW !== next.cssW || prev.cssH !== next.cssH;
  const dpr = Math.abs(prev.dpr - next.dpr) > 1e-6;
  return size && dpr ? "both" : size ? "size" : dpr ? "dpr" : "none";
}

/** Structural subsets so callers / tests need not pass real WebGL objects. */
export type RebindRenderer = {
  setPixelRatio: (r: number) => void;
  setSize: (w: number, h: number, updateStyle?: boolean) => void;
  /** three WebGLRenderer.capabilities — maxTextureSize bounds the buffer edge. */
  capabilities?: { maxTextureSize?: number } | null;
};
export type RebindComposer = {
  setPixelRatio: (r: number) => void;
  setSize: (w: number, h: number) => void;
  readBuffer?: { depthTexture?: THREE.Texture | null } | null;
};
export type RebindTargets = {
  renderer?: RebindRenderer | null;
  /** WebGLRenderer.setSize updateStyle (universe onResize uses false). */
  updateStyle?: boolean;
  composer?: RebindComposer | null;
  camera?: THREE.PerspectiveCamera | null;
  bloom?: { setSize: (w: number, h: number, pixelRatio?: number) => void } | null;
  godRays?: {
    setDepthTexture: (tex: THREE.Texture | null, camera?: THREE.PerspectiveCamera) => void;
    /** #109: optional — the pass also self-reads readBuffer size each render. */
    setBufferSize?: (bufW: number, bufH: number) => number;
  } | null;
  focusDepth?: { setDepthTexture: (tex: THREE.Texture | null) => void } | null;
  bloomGuard?: { setDepthTexture: (tex: THREE.Texture | null) => void } | null;
};
export type RebindStage = "renderer" | "composer" | "bloom" | "godRays" | "focusDepth" | "bloomGuard";
export type RebindReport = {
  viewport: PostfxViewport;
  change: ViewportChange;
  /** Stages that ran without throwing, in order. */
  applied: RebindStage[];
  /** Stages that threw — surfaced, never swallowed silently. */
  errors: Array<{ stage: RebindStage; message: string }>;
};

/**
 * Apply one viewport to the whole light chain in dependency order:
 * renderer DPR+size → composer DPR+size (read/write RTs + scene depth + every
 * pass) → bloom at device px → god-rays / focus-depth / bloom-guard rebound to
 * the live `composer.readBuffer.depthTexture` (null ⇒ luminance-only).
 */
export function rebindPostfxViewport(
  t: RebindTargets,
  vp: PostfxViewport,
  change: ViewportChange = "both",
): RebindReport {
  const applied: RebindStage[] = [];
  const errors: RebindReport["errors"] = [];
  const run = (stage: RebindStage, present: unknown, fn: () => void) => {
    if (!present) return;
    try {
      fn();
      applied.push(stage);
    } catch (e) {
      errors.push({ stage, message: e instanceof Error ? e.message : String(e) });
    }
  };
  run("renderer", t.renderer, () => {
    t.renderer!.setPixelRatio(vp.dpr);
    t.renderer!.setSize(vp.cssW, vp.cssH, t.updateStyle ?? false);
  });
  run("composer", t.composer, () => {
    // setSize first so `_width/_height` become CSS px (the constructor seeds them
    // in device px), then setPixelRatio re-sizes targets + passes at the new DPR.
    t.composer!.setSize(vp.cssW, vp.cssH);
    t.composer!.setPixelRatio(vp.dpr);
  });
  run("bloom", t.bloom, () => t.bloom!.setSize(vp.cssW, vp.cssH, vp.dpr));
  let depth: THREE.Texture | null = null;
  try {
    depth = t.composer?.readBuffer?.depthTexture ?? null;
  } catch {
    depth = null;
  }
  run("godRays", t.godRays, () => {
    t.godRays!.setDepthTexture(depth, t.camera ?? undefined);
    t.godRays!.setBufferSize?.(vp.bufW, vp.bufH);
  });
  run("focusDepth", t.focusDepth, () => t.focusDepth!.setDepthTexture(depth));
  run("bloomGuard", t.bloomGuard, () => t.bloomGuard!.setDepthTexture(depth));
  return { viewport: vp, change, applied, errors };
}

export type PostfxViewportRebind = {
  /** Rebind if CSS size OR DPR changed; null when unchanged / disposed. */
  resize: (cssW: number, cssH: number, rawDpr: number) => RebindReport | null;
  /** Re-apply the last viewport (after composer build / context-loss rebuild). */
  force: () => RebindReport | null;
  readonly viewport: PostfxViewport | null;
  readonly lastReport: RebindReport | null;
  dispose: () => void;
};

/**
 * Stateful wrapper: dedupes on (cssW, cssH, dpr) — not CSS size alone — and
 * re-reads targets every call so context-loss rebuilds that swap handles are
 * picked up without re-wiring.
 */
export function createPostfxViewportRebind(
  getTargets: () => RebindTargets,
  opts: { maxDpr?: number; maxBufferEdge?: number } = {},
): PostfxViewportRebind {
  const edgeOf = (t: RebindTargets | null | undefined) => {
    if (opts.maxBufferEdge != null) return opts.maxBufferEdge;
    try {
      return t?.renderer?.capabilities?.maxTextureSize ?? null;
    } catch {
      return null;
    }
  };
  let vp: PostfxViewport | null = null;
  let last: RebindReport | null = null;
  let disposed = false;
  const apply = (next: PostfxViewport, change: ViewportChange, targets?: RebindTargets) => {
    vp = next;
    last = rebindPostfxViewport(targets ?? getTargets() ?? {}, next, change);
    return last;
  };
  return {
    resize(cssW, cssH, rawDpr) {
      if (disposed) return null;
      const targets = getTargets() ?? {};
      const next = postfxViewport(cssW, cssH, rawDpr, opts.maxDpr, edgeOf(targets));
      const change = viewportChange(vp, next);
      if (change === "none") return null;
      return apply(next, change, targets);
    },
    force() {
      if (disposed || !vp) return null;
      return apply(vp, "none");
    },
    get viewport() {
      return vp;
    },
    get lastReport() {
      return last;
    },
    dispose() {
      disposed = true;
    },
  };
}

export type MatchMediaLike = (query: string) => {
  addEventListener?: (type: "change", fn: () => void) => void;
  removeEventListener?: (type: "change", fn: () => void) => void;
} | null;

/**
 * Fire `onChange(devicePixelRatio)` when the DPR changes (monitor drag / zoom
 * without a CSS-size change — ResizeObserver does not fire for that). Uses a
 * one-shot `(resolution: Xdppx)` media query and re-arms on the new value.
 * Returns an unsubscribe; inert when matchMedia is unavailable.
 */
export function watchDevicePixelRatio(
  win: { devicePixelRatio?: number; matchMedia?: MatchMediaLike },
  onChange: (dpr: number) => void,
): () => void {
  if (typeof win?.matchMedia !== "function") return () => {};
  let stopped = false;
  let detach: (() => void) | null = null;
  const arm = () => {
    if (stopped) return;
    const dpr = win.devicePixelRatio || 1;
    let mql: ReturnType<MatchMediaLike> = null;
    try {
      mql = win.matchMedia!(`(resolution: ${dpr}dppx)`);
    } catch {
      mql = null;
    }
    if (!mql?.addEventListener) return;
    const fn = () => {
      detach?.();
      detach = null;
      if (stopped) return;
      onChange(win.devicePixelRatio || 1);
      arm();
    };
    mql.addEventListener("change", fn);
    detach = () => mql!.removeEventListener?.("change", fn);
  };
  arm();
  return () => {
    stopped = true;
    detach?.();
    detach = null;
  };
}
