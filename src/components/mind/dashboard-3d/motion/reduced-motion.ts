/** prefers-reduced-motion helpers for the cosmos motion lane. */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

export type ReducedMotionMedia = {
  matches: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

export function prefersReducedMotion(
  matchMedia: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia,
): boolean {
  if (typeof matchMedia !== "function") return false;
  try {
    return Boolean(matchMedia(REDUCED_QUERY).matches);
  } catch {
    return false;
  }
}

/**
 * Hydration-safe subscription. Calls `onChange` once with the current match,
 * then again when the query changes. Missing matchMedia (SSR) reports false
 * and returns a no-op unsubscribe.
 */
export function subscribePrefersReducedMotion(
  onChange: (matches: boolean) => void,
  matchMedia: ((query: string) => ReducedMotionMedia) | undefined = globalThis.matchMedia as
    | ((query: string) => ReducedMotionMedia)
    | undefined,
): () => void {
  if (typeof matchMedia !== "function") {
    onChange(false);
    return () => {};
  }
  let mq: ReducedMotionMedia;
  try {
    mq = matchMedia(REDUCED_QUERY);
  } catch {
    onChange(false);
    return () => {};
  }
  const apply = () => onChange(Boolean(mq.matches));
  apply();
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }
  return () => {};
}

export type UniverseFrameSchedule = {
  reducedMotion: boolean;
  /** Camera rig interpolation has finished. */
  rigSettled: boolean;
  /** Pointer, wheel, or pinch is moving the camera. */
  interacting: boolean;
  /** Status payload, resize, or a fly request needs another painted frame. */
  dirty: boolean;
  documentHidden: boolean;
  contextLost: boolean;
};

/**
 * Continuous frames stay on when motion is allowed (hidden and context-lost
 * ticks already skip the GPU draw). Reduced motion parks the loop once the
 * camera is settled and nothing is dirty, so a static frame is not redrawn
 * forever. A lost context keeps the loop alive without drawing so restore
 * is observed.
 */
export function shouldScheduleUniverseFrame(input: UniverseFrameSchedule): boolean {
  if (!input.reducedMotion) return true;
  if (input.contextLost) return true;
  if (input.documentHidden) return false;
  if (!input.rigSettled || input.interacting || input.dirty) return true;
  return false;
}

/** Periodic scene rebuild. Reduced motion never uses the timer (it jitters labels). */
export function shouldSoftSyncScene(reducedMotion: boolean, elapsedMs: number, intervalMs = 5000): boolean {
  if (reducedMotion) return false;
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(intervalMs)) return false;
  return elapsedMs > intervalMs;
}

export type UniverseMotionSignatureInput = {
  bots: Array<{ id: string; health: string; reason: string }>;
  commitShas: string[];
  feedIds: string[];
  pageCount: number;
  edgeCount: number;
  projectKey: string;
};

/** Stable content key. Poll timestamps that do not change these fields stay quiet. */
export function universeMotionSignature(input: UniverseMotionSignatureInput): string {
  const bots = input.bots.map((b) => `${b.id}:${b.health}:${b.reason}`).join(",");
  const commits = input.commitShas.join(",");
  const feed = input.feedIds.join(",");
  const pages = Number.isFinite(input.pageCount) ? input.pageCount : 0;
  const edges = Number.isFinite(input.edgeCount) ? input.edgeCount : 0;
  return `${bots}|${commits}|${feed}|p${pages}|e${edges}|${input.projectKey}`;
}

/** Effective motion scale: 0 when reduced, else 1 (or caller override). */
export function motionScale(reducedMotion: boolean, override?: number): number {
  if (reducedMotion) return 0;
  if (override == null) return 1;
  return override < 0 ? 0 : override > 1 ? 1 : override;
}
