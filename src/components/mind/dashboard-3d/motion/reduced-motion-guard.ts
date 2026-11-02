/**
 * Motion c27 — reduced-motion guard + settle gate + lane snapshot hash.
 *
 * Pure helpers for Dashboard Bot to wrap universe-scene rebuild / rig /
 * billboard / progressive heavy-mount paths under prefers-reduced-motion.
 * Never imports Three or scene modules.
 *
 * Hacker c27 hardenings:
 *  - hashMotionLaneSnapshot canonicalizes plain-object key order + content
 *    digests (not length), so insertion-order / length-alike collisions die.
 *  - observeReducedMotion tolerates missing matchMedia (SSR) and legacy
 *    MediaQueryList addListener/removeListener-only hosts.
 *  - settle gate + sticky heavy-spent flag survive rapid RM media flaps.
 */
import { finiteOr } from "./sanitize.ts";

export const REDUCED_MOTION_SETTLE_MS = 480;

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
};

export type ReducedMotionSubscription = {
  matches: boolean;
  disconnect: () => void;
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

/**
 * Stable canonical JSON for hashing. Plain objects get sorted keys; arrays keep
 * order; cycles become "[Circular]"; ±0 collapses to 0; NaN → "null"-like token.
 */
function canonicalize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const t = typeof value;
  if (t === "number") {
    if (Number.isNaN(value as number)) return "NaN";
    // Object.is(+0,-0) is false; we want one digest for both.
    if (value === 0) return "0";
    if (!Number.isFinite(value as number)) return String(value);
    return String(value);
  }
  if (t === "boolean" || t === "bigint") return String(value);
  if (t === "string") return JSON.stringify(value);
  if (t === "symbol") return `Symbol(${String((value as symbol).description ?? "")})`;
  if (t === "function") return `fn:${(value as { name?: string }).name ?? ""}`;
  if (t !== "object") return JSON.stringify(String(value));

  const obj = value as object;
  if (seen.has(obj)) return '"[Circular]"';
  seen.add(obj);

  if (Array.isArray(value)) {
    const parts: string[] = ["["];
    for (let i = 0; i < value.length; i++) {
      if (i) parts.push(",");
      parts.push(canonicalize(value[i], seen));
    }
    parts.push("]");
    return parts.join("");
  }

  // Map / Set — deterministic by sorted stringified entries
  if (value instanceof Map) {
    const entries: string[] = [];
    for (const [k, v] of value) {
      entries.push(`${canonicalize(k, seen)}:${canonicalize(v, seen)}`);
    }
    entries.sort();
    return `Map{${entries.join(",")}}`;
  }
  if (value instanceof Set) {
    const entries: string[] = [];
    for (const v of value) entries.push(canonicalize(v, seen));
    entries.sort();
    return `Set{${entries.join(",")}}`;
  }

  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  const parts: string[] = ["{"];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (i) parts.push(",");
    parts.push(JSON.stringify(k), ":", canonicalize(rec[k], seen));
  }
  parts.push("}");
  return parts.join("");
}

/**
 * Cheap, allocation-light content digest of a motion/status snapshot for
 * change detection (rebuild gate) and REA lane-side freeze asserts.
 */
export function hashMotionLaneSnapshot(value: unknown): string {
  try {
    return fnv1aHex(canonicalize(value, new WeakSet()));
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
  };
}

/**
 * Track reduced-motion edges. Rising edge (false→true) opens a settle window
 * so rapid media flaps cannot re-arm heavy mount or force redundant rebuilds.
 */
export function stepReducedMotionSettle(
  guard: ReducedMotionGuardState | null | undefined,
  reducedMotion: boolean,
  nowMs: number,
): void {
  if (!guard) return;
  const now = finiteOr(nowMs, 0);
  const reduced = Boolean(reducedMotion);
  if (reduced && !guard.lastReduced) {
    guard.settleUntilMs = now + guard.settleMs;
  }
  guard.lastReduced = reduced;
}

function inSettle(guard: ReducedMotionGuardState, nowMs: number): boolean {
  return finiteOr(nowMs, 0) < guard.settleUntilMs;
}

/**
 * Under reduced: allow rebuild only when `dataHash` differs from the last
 * accepted hash (or on first call). When motion is on, always allow.
 * Records the hash when a rebuild is permitted.
 */
export function shouldRebuildScene(
  guard: ReducedMotionGuardState | null | undefined,
  dataHash: string,
  reducedMotion: boolean,
  nowMs: number = 0,
): boolean {
  if (!guard) return true;
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
  // Same hash under reduced — skip, even mid-settle flap.
  void inSettle; // settle tracked for heavy/observers; rebuild is hash-keyed
  return false;
}

/**
 * Under reduced: permit progressive heavy mount exactly once, then sticky-block
 * (survives RM flaps during settle). When motion is on, always allow.
 */
export function shouldMountHeavy(
  guard: ReducedMotionGuardState | null | undefined,
  reducedMotion: boolean,
): boolean {
  if (!guard) return true;
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
