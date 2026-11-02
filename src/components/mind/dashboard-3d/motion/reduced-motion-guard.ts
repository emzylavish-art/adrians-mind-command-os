/**
 * Motion c27/c28 — reduced-motion guard + settle gate + lane snapshot hash.
 *
 * Pure helpers for Dashboard Bot to wrap universe-scene rebuild / rig /
 * billboard / progressive heavy-mount paths under prefers-reduced-motion.
 * Never imports Three or scene modules.
 *
 * Hacker c27: canonical key-order hash, SSR/legacy matchMedia, RM flap settle.
 * Hacker c28: backwards/skewed nowMs clamp; hash size budget; dispose-safe API;
 *             runReducedMotionGuardHarness (simulated 5s wall clock).
 */
import { finiteOr } from "./sanitize.ts";

export const REDUCED_MOTION_SETTLE_MS = 480;

/** Max canonical-string characters hashed before returning an overflow digest. */
export const HASH_MOTION_SNAPSHOT_MAX_CHARS = 65_536;

export type ReducedMotionGuardOpts = {
  /** Sticky settle window after an RM edge (ms). Default REDUCED_MOTION_SETTLE_MS. */
  settleMs?: number;
};

export type ReducedMotionGuardState = {
  lastDataHash: string;
  heavyMountedOnce: boolean;
  /** Wall-clock ms until which RM flaps are treated as still-settling. */
  settleUntilMs: number;
  settleMs: number;
  /** Last reduced flag seen by stepReducedMotionSettle / decision helpers. */
  lastReduced: boolean;
  primed: boolean;
  /** Monotonic-ish last nowMs; used to detect backwards clock skew. */
  lastNowMs: number;
  disposed: boolean;
};

export type ReducedMotionSubscription = {
  matches: boolean;
  disconnect: () => void;
};

export type HashMotionSnapshotOpts = {
  /** Override HASH_MOTION_SNAPSHOT_MAX_CHARS for this call. */
  maxChars?: number;
};

export type ReducedMotionGuardHarnessOpts = {
  durationMs?: number;
  frameMs?: number;
  reducedMotion?: boolean;
  payloadAt: (tMs: number, frame: number) => unknown;
  settleMs?: number;
};

export type ReducedMotionGuardHarnessReport = {
  frames: number;
  rebuildCount: number;
  heavyCount: number;
  finalRigT: number;
  rebuildAtMs: number[];
  durationMs: number;
  frameMs: number;
  reducedMotion: boolean;
};

type MatchMediaFn = ((query: string) => MediaQueryList | { matches: boolean }) | null | undefined;

/** FNV-1a 32-bit over a UTF-16 code-unit stream → 8-char hex. */
function fnv1aHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

type CanonBudget = { used: number; max: number; overflow: boolean };

function pushCanon(budget: CanonBudget, chunk: string): string {
  if (budget.overflow) return "";
  const next = budget.used + chunk.length;
  if (next > budget.max) {
    budget.overflow = true;
    return "";
  }
  budget.used = next;
  return chunk;
}

/**
 * Stable canonical JSON for hashing. Plain objects get sorted keys; arrays keep
 * order; cycles become "[Circular]"; ±0 collapses to 0; NaN → token.
 * Stops early when `budget` is exhausted.
 */
function canonicalize(value: unknown, seen: WeakSet<object>, budget: CanonBudget): string {
  if (budget.overflow) return "";
  if (value === null) return pushCanon(budget, "null");
  if (value === undefined) return pushCanon(budget, "undefined");
  const t = typeof value;
  if (t === "number") {
    if (Number.isNaN(value as number)) return pushCanon(budget, "NaN");
    if (value === 0) return pushCanon(budget, "0");
    if (!Number.isFinite(value as number)) return pushCanon(budget, String(value));
    return pushCanon(budget, String(value));
  }
  if (t === "boolean" || t === "bigint") return pushCanon(budget, String(value));
  if (t === "string") return pushCanon(budget, JSON.stringify(value));
  if (t === "symbol") return pushCanon(budget, `Symbol(${String((value as symbol).description ?? "")})`);
  if (t === "function") return pushCanon(budget, `fn:${(value as { name?: string }).name ?? ""}`);
  if (t !== "object") return pushCanon(budget, JSON.stringify(String(value)));

  const obj = value as object;
  if (seen.has(obj)) return pushCanon(budget, '"[Circular]"');
  seen.add(obj);

  if (Array.isArray(value)) {
    const parts: string[] = [];
    const open = pushCanon(budget, "[");
    if (budget.overflow) return open;
    parts.push(open);
    for (let i = 0; i < value.length; i++) {
      if (budget.overflow) break;
      if (i) {
        const c = pushCanon(budget, ",");
        if (budget.overflow) break;
        parts.push(c);
      }
      parts.push(canonicalize(value[i], seen, budget));
    }
    if (!budget.overflow) parts.push(pushCanon(budget, "]"));
    return parts.join("");
  }

  if (value instanceof Map) {
    const entries: string[] = [];
    for (const [k, v] of value) {
      if (budget.overflow) break;
      entries.push(`${canonicalize(k, seen, budget)}:${canonicalize(v, seen, budget)}`);
    }
    entries.sort();
    return pushCanon(budget, "Map{") + (budget.overflow ? "" : entries.join(",")) + (budget.overflow ? "" : pushCanon(budget, "}"));
  }
  if (value instanceof Set) {
    const entries: string[] = [];
    for (const v of value) {
      if (budget.overflow) break;
      entries.push(canonicalize(v, seen, budget));
    }
    entries.sort();
    return pushCanon(budget, "Set{") + (budget.overflow ? "" : entries.join(",")) + (budget.overflow ? "" : pushCanon(budget, "}"));
  }

  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  const parts: string[] = [];
  parts.push(pushCanon(budget, "{"));
  for (let i = 0; i < keys.length; i++) {
    if (budget.overflow) break;
    const k = keys[i]!;
    if (i) parts.push(pushCanon(budget, ","));
    if (budget.overflow) break;
    parts.push(pushCanon(budget, JSON.stringify(k)));
    if (budget.overflow) break;
    parts.push(pushCanon(budget, ":"));
    if (budget.overflow) break;
    parts.push(canonicalize(rec[k], seen, budget));
  }
  if (!budget.overflow) parts.push(pushCanon(budget, "}"));
  return parts.join("");
}

/**
 * Cheap content digest of a motion/status snapshot. Caps canonical size at
 * `maxChars` (default HASH_MOTION_SNAPSHOT_MAX_CHARS) so huge payloads cannot
 * cliff the main thread — overflow returns a stable sentinel digest.
 */
export function hashMotionLaneSnapshot(value: unknown, opts?: HashMotionSnapshotOpts): string {
  const max = Math.max(
    64,
    Math.floor(finiteOr(opts?.maxChars ?? HASH_MOTION_SNAPSHOT_MAX_CHARS, HASH_MOTION_SNAPSHOT_MAX_CHARS)),
  );
  try {
    const budget: CanonBudget = { used: 0, max, overflow: false };
    const canon = canonicalize(value, new WeakSet(), budget);
    if (budget.overflow) return fnv1aHex(`overflow:${max}`);
    return fnv1aHex(canon);
  } catch {
    return fnv1aHex("throw");
  }
}

export function createReducedMotionGuard(opts?: ReducedMotionGuardOpts): ReducedMotionGuardState {
  const settleMs = Math.max(0, Math.floor(finiteOr(opts?.settleMs ?? REDUCED_MOTION_SETTLE_MS, REDUCED_MOTION_SETTLE_MS)));
  return {
    lastDataHash: "",
    heavyMountedOnce: false,
    settleUntilMs: 0,
    settleMs,
    lastReduced: false,
    primed: false,
    lastNowMs: 0,
    disposed: false,
  };
}

/** Mark guard disposed — subsequent rebuild/heavy decisions deny; settle no-ops. */
export function disposeReducedMotionGuard(guard: ReducedMotionGuardState | null | undefined): void {
  if (!guard) return;
  guard.disposed = true;
}

function sanitizeNowMs(nowMs: number): number {
  // Reject NaN / ±Infinity / negatives — treat as 0 so settle math stays finite.
  if (!Number.isFinite(nowMs) || nowMs < 0) return 0;
  return nowMs;
}

/**
 * Track reduced-motion edges. Rising edge (false→true) opens a settle window
 * so rapid media flaps cannot re-arm heavy mount or force redundant rebuilds.
 * Backwards nowMs clamps settleUntil so a clock rewind cannot strand settle
 * in the far future relative to the new timeline.
 */
export function stepReducedMotionSettle(
  guard: ReducedMotionGuardState | null | undefined,
  reducedMotion: boolean,
  nowMs: number,
): void {
  if (!guard || guard.disposed) return;
  const now = sanitizeNowMs(nowMs);
  const reduced = Boolean(reducedMotion);

  // Clock skew / rewind: pull settle window back onto the new timeline.
  if (now < guard.lastNowMs) {
    if (guard.settleUntilMs > now + guard.settleMs) {
      guard.settleUntilMs = now + guard.settleMs;
    }
  }
  guard.lastNowMs = now;

  if (reduced && !guard.lastReduced) {
    guard.settleUntilMs = now + guard.settleMs;
  }
  guard.lastReduced = reduced;
}

function inSettle(guard: ReducedMotionGuardState, nowMs: number): boolean {
  return sanitizeNowMs(nowMs) < guard.settleUntilMs;
}

/**
 * Under reduced: allow rebuild only when `dataHash` differs from the last
 * accepted hash (or on first call). When motion is on, always allow (unless disposed).
 * Records the hash when a rebuild is permitted.
 */
export function shouldRebuildScene(
  guard: ReducedMotionGuardState | null | undefined,
  dataHash: string,
  reducedMotion: boolean,
  nowMs: number = 0,
): boolean {
  if (!guard) return true;
  if (guard.disposed) return false;
  stepReducedMotionSettle(guard, reducedMotion, nowMs);
  const hash = typeof dataHash === "string" ? dataHash : hashMotionLaneSnapshot(dataHash);
  if (!reducedMotion) {
    guard.lastDataHash = hash;
    guard.primed = true;
    return true;
  }
  if (!guard.primed || guard.lastDataHash !== hash) {
    guard.lastDataHash = hash;
    guard.primed = true;
    return true;
  }
  void inSettle;
  return false;
}

/**
 * Under reduced: permit progressive heavy mount exactly once, then sticky-block.
 * Disposed → always deny. When motion is on and not disposed, always allow.
 */
export function shouldMountHeavy(
  guard: ReducedMotionGuardState | null | undefined,
  reducedMotion: boolean,
): boolean {
  if (!guard) return true;
  if (guard.disposed) return false;
  if (!reducedMotion) return true;
  if (guard.heavyMountedOnce) return false;
  guard.heavyMountedOnce = true;
  return true;
}

/**
 * Snap camera/rig ease to finished under reduced. Safe on null / NaN `t`.
 */
export function snapRigProgress(
  rig: { t: number } | null | undefined,
  reducedMotion: boolean,
): void {
  if (!rig || !reducedMotion) return;
  rig.t = 1;
}

/**
 * Lane-side harness: drive shouldRebuildScene / shouldMountHeavy / snapRigProgress
 * over a simulated wall clock. Proves zero rebuild churn when data is stable and
 * exactly one rebuild per real payload change under reduced motion.
 */
export function runReducedMotionGuardHarness(
  opts: ReducedMotionGuardHarnessOpts,
): ReducedMotionGuardHarnessReport {
  const durationMs = Math.max(0, Math.floor(finiteOr(opts.durationMs ?? 5000, 5000)));
  const frameMs = Math.max(1, Math.floor(finiteOr(opts.frameMs ?? 100, 100)));
  const reduced = Boolean(opts.reducedMotion ?? true);
  const guard = createReducedMotionGuard({ settleMs: opts.settleMs });
  const rig = { t: 0 };
  let rebuildCount = 0;
  let heavyCount = 0;
  const rebuildAtMs: number[] = [];
  let frames = 0;
  const payloadAt = typeof opts.payloadAt === "function" ? opts.payloadAt : () => null;

  for (let t = 0; t <= durationMs; t += frameMs) {
    frames++;
    let payload: unknown;
    try {
      payload = payloadAt(t, frames - 1);
    } catch {
      payload = { __harness_payload_throw: true };
    }
    const hash = hashMotionLaneSnapshot(payload);
    if (shouldRebuildScene(guard, hash, reduced, t)) {
      rebuildCount++;
      rebuildAtMs.push(t);
    }
    if (shouldMountHeavy(guard, reduced)) heavyCount++;
    snapRigProgress(rig, reduced);
    if (!reduced && rig.t < 1) {
      // mimic a short ease when motion is on
      rig.t = Math.min(1, rig.t + frameMs / 400);
    }
  }

  return {
    frames,
    rebuildCount,
    heavyCount,
    finalRigT: rig.t,
    rebuildAtMs,
    durationMs,
    frameMs,
    reducedMotion: reduced,
  };
}

/**
 * Subscribe to prefers-reduced-motion. Tolerates:
 *  - missing / non-function matchMedia (SSR) → matches=false
 *  - matchMedia throw → matches=false
 *  - legacy addListener / removeListener only (old Safari)
 *  - modern addEventListener / removeEventListener
 */
export function observeReducedMotion(
  onChange: (matches: boolean) => void,
  matchMedia: MatchMediaFn = typeof globalThis.matchMedia === "function" ? globalThis.matchMedia.bind(globalThis) : null,
): ReducedMotionSubscription {
  const safeOnChange = typeof onChange === "function" ? onChange : () => {};
  if (typeof matchMedia !== "function") {
    return { matches: false, disconnect() {} };
  }

  let mql: MediaQueryList | { matches: boolean } | null = null;
  try {
    mql = matchMedia("(prefers-reduced-motion: reduce)");
  } catch {
    return { matches: false, disconnect() {} };
  }
  if (!mql || typeof (mql as { matches?: unknown }).matches !== "boolean") {
    return { matches: false, disconnect() {} };
  }

  const handler = () => {
    try {
      safeOnChange(Boolean((mql as MediaQueryList).matches));
    } catch {
      /* listener must not break the frame */
    }
  };

  const modern = mql as MediaQueryList;
  let mode: "modern" | "legacy" | "none" = "none";
  try {
    if (typeof modern.addEventListener === "function") {
      modern.addEventListener("change", handler);
      mode = "modern";
    } else if (typeof (modern as unknown as { addListener?: Function }).addListener === "function") {
      (modern as unknown as { addListener: (fn: () => void) => void }).addListener(handler);
      mode = "legacy";
    }
  } catch {
    mode = "none";
  }

  return {
    matches: Boolean(modern.matches),
    disconnect() {
      try {
        if (mode === "modern" && typeof modern.removeEventListener === "function") {
          modern.removeEventListener("change", handler);
        } else if (mode === "legacy") {
          const legacy = modern as unknown as { removeListener?: (fn: () => void) => void };
          if (typeof legacy.removeListener === "function") legacy.removeListener(handler);
        }
      } catch {
        /* disconnect is best-effort */
      }
    },
  };
}
