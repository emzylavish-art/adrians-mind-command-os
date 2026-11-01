/**
 * WebGL context-loss recovery helper (light lane, queue #13).
 *
 * Listens for webglcontextlost / webglcontextrestored on the renderer canvas.
 * On lost: mark honest `lost` state, dispose current bloom/grade/god-ray/exposure
 * handles (no GPU work while frozen). On restored: rebuild fresh handles via the
 * caller-supplied factory, then clear `lost`. Dispose removes listeners and
 * frees handles — no leaks, no double-attach.
 *
 * Pure orchestration; Dashboard Bot wires the factory to EffectComposer (see README).
 */
import type { TunedBloomHandle } from "./bloom-tuning.ts";
import type { ColorGradeHandle } from "./color-grade.ts";
import type { GodRayHandle } from "./god-rays.ts";
import type { ExposureRideHandle } from "./exposure-ride.ts";
import type { FocusDepthHandle } from "./focus-depth.ts";
import type { FocusBloomGuardHandle } from "./focus-bloom-guard.ts";

export type PostfxBundle = {
  bloom?: TunedBloomHandle | null;
  grade?: ColorGradeHandle | null;
  godRays?: GodRayHandle | null;
  exposure?: ExposureRideHandle | null;
  focusDepth?: FocusDepthHandle | null;
  /** #57: guard attached to `bloom`; disposed first, re-created by the factory. */
  focusBloomGuard?: FocusBloomGuardHandle | null;
};

export type PostfxRebuildFactory = () => PostfxBundle;

export type ContextLossHandle = {
  /** True while the WebGL context is lost (render loop should pause). */
  readonly lost: boolean;
  /** Current live bundle (nullish fields while lost / before first restore). */
  readonly bundle: PostfxBundle;
  /** Replace the rebuild factory (e.g. after resize changes size closure). */
  setFactory: (factory: PostfxRebuildFactory) => void;
  /** Manually mark lost (tests / non-DOM). Disposes current GPU handles. */
  notifyLost: () => void;
  /** Manually rebuild after restore (tests / non-DOM). */
  notifyRestored: () => void;
  dispose: () => void;
};

/** Minimal DOM-like target (HTMLCanvasElement or a test double). */
export type ContextLossCanvas = {
  addEventListener: (type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: EventListener, options?: boolean | EventListenerOptions) => void;
};

export type CreateContextLossOpts = {
  /** Canvas / DOM target that emits webglcontext* events (renderer.domElement). */
  canvas?: ContextLossCanvas | null;
  /** Optional initial handles already wired into the composer. */
  initial?: PostfxBundle;
  /** Rebuild bloom/grade/god-ray/exposure after context restore. Required for recovery. */
  factory?: PostfxRebuildFactory;
};

function disposeBundle(bundle: PostfxBundle): void {
  bundle.focusBloomGuard?.dispose();
  bundle.bloom?.dispose();
  bundle.grade?.dispose();
  bundle.godRays?.dispose();
  bundle.exposure?.dispose();
  bundle.focusDepth?.dispose();
}

/**
 * Attach context-loss listeners and own the postfx handle lifecycle across loss/restore.
 */
export function createContextLossRecovery(opts: CreateContextLossOpts = {}): ContextLossHandle {
  let disposed = false;
  let lost = false;
  let factory: PostfxRebuildFactory | null = opts.factory ?? null;
  let bundle: PostfxBundle = {
    bloom: opts.initial?.bloom ?? null,
    grade: opts.initial?.grade ?? null,
    godRays: opts.initial?.godRays ?? null,
    exposure: opts.initial?.exposure ?? null,
    focusDepth: opts.initial?.focusDepth ?? null,
    focusBloomGuard: opts.initial?.focusBloomGuard ?? null,
  };

  const onLost = (ev?: Event) => {
    if (disposed) return;
    // Browser fires Event; preventDefault so the context can restore.
    if (ev && typeof (ev as WebGLContextEvent).preventDefault === "function") {
      (ev as WebGLContextEvent).preventDefault();
    }
    if (lost) return;
    lost = true;
    disposeBundle(bundle);
    bundle = { bloom: null, grade: null, godRays: null, exposure: null, focusDepth: null, focusBloomGuard: null };
  };

  const applyFactoryOnce = (): boolean => {
    if (!factory) return false;
    const next = factory();
    bundle = {
      bloom: next.bloom ?? null,
      grade: next.grade ?? null,
      godRays: next.godRays ?? null,
      exposure: next.exposure ?? null,
      focusDepth: next.focusDepth ?? null,
      focusBloomGuard: next.focusBloomGuard ?? null,
    };
    return true;
  };

  const onRestored = () => {
    if (disposed) return;
    // Always dispose any stale refs before rebuild (idempotent).
    disposeBundle(bundle);
    bundle = { bloom: null, grade: null, godRays: null, exposure: null, focusDepth: null, focusBloomGuard: null };
    if (!factory) {
      lost = false;
      return;
    }
    // Scene-side rebuild retry: factory can throw on a half-restored GL context.
    // Catch, clear `lost` so the RAF loop can run, retry once, then accept nulls.
    try {
      applyFactoryOnce();
      lost = false;
    } catch {
      lost = false;
      try {
        applyFactoryOnce();
      } catch {
        bundle = { bloom: null, grade: null, godRays: null, exposure: null, focusDepth: null, focusBloomGuard: null };
      }
    }
  };

  const canvas = opts.canvas ?? null;
  if (canvas && typeof canvas.addEventListener === "function") {
    canvas.addEventListener("webglcontextlost", onLost as EventListener, false);
    canvas.addEventListener("webglcontextrestored", onRestored as EventListener, false);
  }

  return {
    get lost() {
      return lost;
    },
    get bundle() {
      return bundle;
    },
    setFactory(next) {
      if (disposed) return;
      factory = next;
    },
    notifyLost() {
      onLost();
    },
    notifyRestored() {
      onRestored();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (canvas && typeof canvas.removeEventListener === "function") {
        canvas.removeEventListener("webglcontextlost", onLost as EventListener, false);
        canvas.removeEventListener("webglcontextrestored", onRestored as EventListener, false);
      }
      disposeBundle(bundle);
      bundle = { bloom: null, grade: null, godRays: null, exposure: null, focusDepth: null, focusBloomGuard: null };
      factory = null;
      lost = false;
    },
  };
}
