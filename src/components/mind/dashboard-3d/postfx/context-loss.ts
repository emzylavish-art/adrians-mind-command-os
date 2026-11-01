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
import type { DetailBackdropDimHandle } from "./detail-backdrop-dim.ts";

export type PostfxBundle = {
  bloom?: TunedBloomHandle | null;
  grade?: ColorGradeHandle | null;
  godRays?: GodRayHandle | null;
  exposure?: ExposureRideHandle | null;
  focusDepth?: FocusDepthHandle | null;
  /** #57: guard attached to `bloom`; disposed first, re-created by the factory. */
  focusBloomGuard?: FocusBloomGuardHandle | null;
  /** #60: detail-card backdrop dim ShaderPass. */
  detailDim?: DetailBackdropDimHandle | null;
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
  /** Last dispose/rebuild failure (null when clean). Surfaced, never swallowed. */
  readonly lastError: ContextLossError | null;
  dispose: () => void;
};

export type ContextLossErrorStage = "dispose" | "rebuild";
export type ContextLossError = { stage: ContextLossErrorStage; error: unknown };

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
  /**
   * Called for every dispose / rebuild failure. Default: console.error.
   * HACKER (#60 cycle): one throwing dispose used to abort the rest (GPU leak)
   * and a throwing dispose/factory left `lost` true forever — the render loop
   * pauses on `lost`, so the dashboard froze on the last-frame snapshot.
   */
  onError?: (stage: ContextLossErrorStage, error: unknown) => void;
};

const EMPTY = (): PostfxBundle => ({
  bloom: null,
  grade: null,
  godRays: null,
  exposure: null,
  focusDepth: null,
  focusBloomGuard: null,
  detailDim: null,
});

/** Dispose every handle in isolation (guard first: it restores bloom's material). */
function disposeBundle(bundle: PostfxBundle, report: (error: unknown) => void): void {
  const order = [
    bundle.focusBloomGuard,
    bundle.bloom,
    bundle.grade,
    bundle.godRays,
    bundle.exposure,
    bundle.focusDepth,
    bundle.detailDim,
  ];
  for (const h of order) {
    if (!h) continue;
    try {
      h.dispose();
    } catch (error) {
      report(error);
    }
  }
}

/**
 * Attach context-loss listeners and own the postfx handle lifecycle across loss/restore.
 */
export function createContextLossRecovery(opts: CreateContextLossOpts = {}): ContextLossHandle {
  let disposed = false;
  let lost = false;
  let lastError: ContextLossError | null = null;
  const report = (stage: ContextLossErrorStage) => (error: unknown) => {
    lastError = { stage, error };
    try {
      if (opts.onError) opts.onError(stage, error);
      else console.error(`[postfx context-loss] ${stage} failed`, error);
    } catch {
      /* reporter itself must not re-freeze recovery */
    }
  };
  const release = () => {
    const old = bundle;
    bundle = EMPTY(); // clear refs first so a throw can't leave stale handles to re-dispose
    disposeBundle(old, report("dispose"));
  };
  let factory: PostfxRebuildFactory | null = opts.factory ?? null;
  let bundle: PostfxBundle = {
    bloom: opts.initial?.bloom ?? null,
    grade: opts.initial?.grade ?? null,
    godRays: opts.initial?.godRays ?? null,
    exposure: opts.initial?.exposure ?? null,
    focusDepth: opts.initial?.focusDepth ?? null,
    focusBloomGuard: opts.initial?.focusBloomGuard ?? null,
    detailDim: opts.initial?.detailDim ?? null,
  };

  const onLost = (ev?: Event) => {
    if (disposed) return;
    // Browser fires Event; preventDefault so the context can restore.
    if (ev && typeof (ev as WebGLContextEvent).preventDefault === "function") {
      (ev as WebGLContextEvent).preventDefault();
    }
    if (lost) return;
    lost = true;
    release();
  };

  const onRestored = () => {
    if (disposed) return;
    // Always dispose any stale refs before rebuild (idempotent).
    release();
    if (!factory) {
      lost = false;
      return;
    }
    let next: PostfxBundle;
    try {
      next = factory() ?? {};
    } catch (error) {
      // Context is back: resume the loop (caller falls back to plain render on
      // nullish handles) and surface the failure instead of freezing forever.
      report("rebuild")(error);
      lost = false;
      return;
    }
    bundle = {
      bloom: next.bloom ?? null,
      grade: next.grade ?? null,
      godRays: next.godRays ?? null,
      exposure: next.exposure ?? null,
      focusDepth: next.focusDepth ?? null,
      focusBloomGuard: next.focusBloomGuard ?? null,
      detailDim: next.detailDim ?? null,
    };
    lost = false;
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
    get lastError() {
      return lastError;
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
      release();
      factory = null;
      lost = false;
    },
  };
}
