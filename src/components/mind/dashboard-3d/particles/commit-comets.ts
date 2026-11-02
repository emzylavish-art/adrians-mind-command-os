import * as THREE from "three";
import { clampInt, finiteOr } from "../motion/sanitize.ts";
import { sharedMotionClock, type MotionClock } from "../motion/motion-clock.ts";
import { cometHeadSize, type CometLaunchSample } from "../motion/comet-launch-ease.ts";
import { isDocumentHidden } from "./motion-lod.ts";

export const COMET_SEGMENTS_MIN = 2;
export const COMET_SEGMENTS_DEFAULT = 24;
export const COMET_MAX_DEFAULT = 6;
export const COMET_MAX_HARD = 24;

/** c30: phase delta below this is treated as a stalled clock (no GPU re-upload). */
export const COMET_ARC_PHASE_EPS = 1e-9;

type CometArcUploadStats = { arcs: number; heads: number };
let arcUploadStats: CometArcUploadStats = { arcs: 0, heads: 0 };

/** Test hook: zero GPU-upload counters. */
export function resetCometArcUploadStats(): void {
  arcUploadStats = { arcs: 0, heads: 0 };
}

/** Test hook: snapshot + zero counters. */
export function takeCometArcUploadStats(): CometArcUploadStats {
  const out = { arcs: arcUploadStats.arcs, heads: arcUploadStats.heads };
  arcUploadStats = { arcs: 0, heads: 0 };
  return out;
}

export type CommitTrailInput = {
  sha?: string | null;
  subject?: string;
};

export type CommitCometsHandle = {
  group: THREE.Group;
  count: number;
  /** c22: sha per comet index (keys for reconcileCometLaunch). Optional for hand-built handles. */
  shas?: readonly string[];
  /** c24: per-comet line / head refs by index (no per-frame getObjectByName). Emptied on dispose. */
  lines?: readonly THREE.Line[];
  heads?: readonly THREE.Points[];
  disposed: boolean;
  update: (tSeconds: number, reducedMotion: boolean) => void;
  dispose: () => void;
};

export type CreateCommitCometsOpts = {
  max?: number;
  radius?: number;
  segments?: number;
  /** Continuous clock (default shared) — survives the scene's 5s comet rebuild. */
  clock?: MotionClock;
};

type CometState = {
  phase: number;
  speed: number;
  incline: number;
  yaw: number;
  color: number;
  line: THREE.Line;
  positions: Float32Array;
  head: THREE.Points;
  headPos: Float32Array;
  /** Last head phase uploaded to the GPU (NaN = never). */
  lastUploadedHead: number;
  lastLineOpacity: number;
  lastHeadOpacity: number;
};

/** Tail brightness at u∈[0,1] (0 = head). Additive blending makes 0 fully transparent. */
export function cometTailFade(u: number): number {
  const x = Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : 1;
  return Math.pow(1 - x, 1.6);
}

// One soft radial sprite shared by every comet head; refcounted so the scene's 5s comet
// rebuild never re-uploads it and the last dispose frees it.
let headSprite: THREE.DataTexture | null = null;
let headSpriteRefs = 0;
const HEAD_SPRITE_SIZE = 32;

function acquireHeadSprite(): THREE.DataTexture {
  if (headSpriteTimer) {
    clearTimeout(headSpriteTimer);
    headSpriteTimer = null;
  }
  if (!headSprite) {
    const n = HEAD_SPRITE_SIZE;
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = (x + 0.5) / n - 0.5;
        const dy = (y + 0.5) / n - 0.5;
        const r = Math.min(1, Math.hypot(dx, dy) * 2);
        const a = Math.pow(1 - r, 2.2);
        const o = (y * n + x) * 4;
        data[o] = 255;
        data[o + 1] = 255;
        data[o + 2] = 255;
        data[o + 3] = Math.round(a * 255);
      }
    }
    headSprite = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    headSprite.magFilter = THREE.LinearFilter;
    headSprite.minFilter = THREE.LinearFilter;
    headSprite.needsUpdate = true;
  }
  headSpriteRefs++;
  return headSprite;
}

let headSpriteTimer: ReturnType<typeof setTimeout> | null = null;
/** Grace period before freeing the sprite at refcount 0: the scene disposes then recreates
 * comets every 5s, so an immediate free would re-upload the texture on every rebuild. */
export const HEAD_SPRITE_GRACE_MS = 2000;

function releaseHeadSprite(): void {
  if (headSpriteRefs <= 0) return;
  headSpriteRefs--;
  if (headSpriteRefs === 0 && headSprite && !headSpriteTimer) {
    const t = setTimeout(() => {
      headSpriteTimer = null;
      if (headSpriteRefs === 0 && headSprite) {
        headSprite.dispose();
        headSprite = null;
      }
    }, HEAD_SPRITE_GRACE_MS);
    (t as { unref?: () => void }).unref?.();
    headSpriteTimer = t;
  }
}

/** Test hook: free the idle sprite now (as the grace timer would). */
export function flushCometHeadSprite(): boolean {
  if (headSpriteTimer) {
    clearTimeout(headSpriteTimer);
    headSpriteTimer = null;
  }
  if (headSpriteRefs === 0 && headSprite) {
    headSprite.dispose();
    headSprite = null;
    return true;
  }
  return false;
}

/** Test hook: live refcount of the shared comet-head sprite. */
export function cometHeadSpriteRefs(): number {
  return headSpriteRefs;
}

const LINE_OPACITY = 0.9;
const LINE_OPACITY_REDUCED = 0.45;
const HEAD_OPACITY = 0.95;
const HEAD_OPACITY_REDUCED = 0.4;

/** c23: max sha chars used for identity / hue / orbit (hostile mega-sha must not burn a frame). */
export const COMET_SHA_KEY_MAX = 128;

function shaKey(sha: string): string {
  return sha.length > COMET_SHA_KEY_MAX ? sha.slice(0, COMET_SHA_KEY_MAX) : sha;
}

function hashSha(sha: string): number {
  let h = 0;
  for (let i = 0; i < sha.length; i++) h = (h * 33 + sha.charCodeAt(i)) | 0;
  return h >>> 0;
}

function hashHue(sha: string): number {
  return hashSha(sha) % 360;
}

/** Second, decorrelated 32-bit hash (FNV-1a) so orbit params don't track the hue. */
function hashSha2(sha: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < sha.length; i++) {
    h ^= sha.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type CometOrbit = { phase: number; speed: number; incline: number; yaw: number };

/**
 * c23: orbit params derived from the commit sha (not the list index), so when a new commit
 * is prepended the existing comets keep their exact orbits and only the new one appears.
 * Ranges match the old index-derived ones (speed 0.22–0.32, incline 0.25–0.49).
 */
export function cometOrbitForSha(sha: string): CometOrbit {
  const key = typeof sha === "string" ? shaKey(sha) : "";
  const a = hashSha2(key);
  const b = hashSha(key);
  return {
    phase: ((a & 0xffff) / 0x10000) * Math.PI * 2,
    speed: 0.22 + (((a >>> 16) & 0xff) / 255) * 0.1,
    incline: 0.25 + ((b & 0xff) / 255) * 0.24,
    yaw: (((b >>> 8) & 0xffff) / 0x10000) * Math.PI * 2,
  };
}

/**
 * c23: the exact comet list createCommitComets would build — non-empty string shas,
 * first occurrence wins (duplicates across branch feeds were drawn as two identical
 * comets), capped at `max`. Keys are capped at COMET_SHA_KEY_MAX chars.
 */
export function commitCometKeys(
  commits: readonly CommitTrailInput[] | null | undefined,
  max: number = COMET_MAX_DEFAULT,
): string[] {
  const cap = clampInt(max, 0, COMET_MAX_HARD, COMET_MAX_DEFAULT);
  const out: string[] = [];
  if (!Array.isArray(commits) || cap === 0) return out;
  // Bounded scan: a hostile 1e6-row feed of duplicates must not walk forever.
  const scanMax = Math.min(commits.length, 4096);
  for (let i = 0; i < scanMax && out.length < cap; i++) {
    const c = commits[i] as CommitTrailInput | null | undefined;
    if (!c || typeof c !== "object" || typeof c.sha !== "string" || c.sha.length === 0) continue;
    const k = shaKey(c.sha);
    if (out.includes(k)) continue;
    out.push(k);
  }
  return out;
}

type SyncMeta = { max: number; radius: number; segments: number; clock: MotionClock };
const syncMeta = new WeakMap<CommitCometsHandle, SyncMeta>();

/**
 * Commit → comet trails. segments clamped ≥2 (avoids /0 → NaN arcs).
 * dispose() idempotent; update() after dispose is a no-op.
 * Skips commits with empty/missing sha rather than fabricating.
 */
export function createCommitComets(
  scene: THREE.Scene,
  commits: readonly CommitTrailInput[] | null | undefined,
  opts: CreateCommitCometsOpts | null | undefined = {},
): CommitCometsHandle {
  // Hacker c24: null / non-object opts threw on opts.max (5s sync / mount abort).
  const o = opts && typeof opts === "object" ? opts : {};
  const max = clampInt(o.max ?? COMET_MAX_DEFAULT, 0, COMET_MAX_HARD, COMET_MAX_DEFAULT);
  const radius = Math.max(0.01, finiteOr(o.radius ?? 14, 14));
  const segments = clampInt(o.segments ?? COMET_SEGMENTS_DEFAULT, COMET_SEGMENTS_MIN, 128, COMET_SEGMENTS_DEFAULT);
  const clock = o.clock ?? sharedMotionClock;
  const group = new THREE.Group();
  group.name = "motion-commit-comets";
  scene.add(group);

  const list = commitCometKeys(commits, max);

  const comets: CometState[] = [];
  const handle: CommitCometsHandle = {
    group,
    count: 0,
    disposed: false,
    update: () => {},
    dispose: () => {},
  };

  const sprite = list.length > 0 ? acquireHeadSprite() : null;
  list.forEach((sha, i) => {
    const positions = new Float32Array(segments * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const hue = hashHue(sha);
    const color = new THREE.Color(`hsl(${hue}, 70%, 65%)`);
    // Head→tail gradient baked once into vertex colors (fade depends only on u).
    const colors = new Float32Array(segments * 3);
    const denom = segments - 1;
    for (let sIdx = 0; sIdx < segments; sIdx++) {
      const f = cometTailFade(sIdx / denom);
      colors[sIdx * 3] = color.r * f;
      colors[sIdx * 3 + 1] = color.g * f;
      colors[sIdx * 3 + 2] = color.b * f;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: LINE_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.name = `motion-comet-${i}`;
    group.add(line);

    const headPos = new Float32Array(3);
    const headGeo = new THREE.BufferGeometry();
    headGeo.setAttribute("position", new THREE.BufferAttribute(headPos, 3));
    const headMat = new THREE.PointsMaterial({
      color: color.clone().lerp(new THREE.Color(0xffffff), 0.45),
      size: Math.max(0.18, radius * 0.045),
      sizeAttenuation: true,
      map: sprite,
      transparent: true,
      opacity: HEAD_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const head = new THREE.Points(headGeo, headMat);
    head.name = `motion-comet-head-${i}`;
    head.frustumCulled = false; // 1-vertex bounds go stale as the head moves
    // c22: fixed base for cometHeadSize (scene must not compound mat.size per frame).
    head.userData.baseSize = headMat.size;
    group.add(head);
    const orbit = cometOrbitForSha(sha);
    comets.push({
      phase: orbit.phase,
      speed: orbit.speed,
      incline: orbit.incline,
      yaw: orbit.yaw,
      color: color.getHex(),
      line,
      positions,
      head,
      headPos,
      lastUploadedHead: Number.NaN,
      lastLineOpacity: Number.NaN,
      lastHeadOpacity: Number.NaN,
    });
  });
  handle.count = comets.length;
  handle.shas = list;
  const lines = comets.map((c) => c.line);
  const heads = comets.map((c) => c.head);
  handle.lines = lines;
  handle.heads = heads;
  syncMeta.set(handle, { max, radius, segments, clock });

  /**
   * c30: always write CPU positions (identical motion). GPU upload is dirty-only:
   * skipped when |head - lastUploadedHead| < COMET_ARC_PHASE_EPS (stalled clock /
   * duplicate map(t)). When uploading, mark update ranges so three can bufferSubData
   * just the arc / head floats instead of a blind full-buffer invalidate.
   */
  const writeArc = (c: CometState, head: number, forceUpload = false): boolean => {
    const pos = c.positions;
    const denom = segments - 1; // >= 1 by clamp
    for (let s = 0; s < segments; s++) {
      const u = s / denom;
      const ang = head - u * 0.85;
      const r = radius * (0.85 + 0.15 * Math.sin(ang * 0.5 + c.phase));
      const x = Math.cos(ang + c.yaw) * r;
      const z = Math.sin(ang + c.yaw) * r;
      const y = Math.sin(ang * c.incline + c.phase) * (radius * 0.22);
      const o = s * 3;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
    }
    c.headPos[0] = pos[0]!;
    c.headPos[1] = pos[1]!;
    c.headPos[2] = pos[2]!;

    const stalled =
      !forceUpload &&
      Number.isFinite(c.lastUploadedHead) &&
      Math.abs(head - c.lastUploadedHead) < COMET_ARC_PHASE_EPS;
    if (stalled) return false;

    const attr = c.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const floatCount = segments * 3;
    if (floatCount > 0 && typeof attr.clearUpdateRanges === "function") {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, floatCount);
    }
    attr.needsUpdate = true;
    arcUploadStats.arcs++;

    const headAttr = c.head.geometry.getAttribute("position") as THREE.BufferAttribute;
    if (typeof headAttr.clearUpdateRanges === "function") {
      headAttr.clearUpdateRanges();
      headAttr.addUpdateRange(0, 3);
    }
    headAttr.needsUpdate = true;
    arcUploadStats.heads++;

    c.lastUploadedHead = head;
    return true;
  };

  const setOpacity = (c: CometState, line: number, head: number) => {
    if (c.lastLineOpacity !== line) {
      (c.line.material as THREE.LineBasicMaterial).opacity = line;
      c.lastLineOpacity = line;
    }
    if (c.lastHeadOpacity !== head) {
      (c.head.material as THREE.PointsMaterial).opacity = head;
      c.lastHeadOpacity = head;
    }
  };

  for (const c of comets) writeArc(c, c.phase, true);

  // Duplicate update(t) with the same mapped wall time → no GPU work (c30).
  let lastMappedT = Number.NaN;

  handle.update = (tSeconds: number, reducedMotion: boolean) => {
    if (handle.disposed) return;
    if (reducedMotion) {
      for (const c of comets) setOpacity(c, LINE_OPACITY_REDUCED, HEAD_OPACITY_REDUCED);
      lastMappedT = Number.NaN; // force re-upload when motion resumes
      return;
    }
    if (isDocumentHidden()) return;
    const t = clock.map(tSeconds);
    if (t === lastMappedT && comets.length > 0) {
      // Opacity already at motion values from the prior call; arcs match this t.
      return;
    }
    lastMappedT = t;
    for (const c of comets) {
      setOpacity(c, LINE_OPACITY, HEAD_OPACITY);
      writeArc(c, t * c.speed + c.phase, false);
    }
  };

  handle.dispose = () => {
    if (handle.disposed) return;
    handle.disposed = true;
    for (const c of comets) {
      // Hacker c25: context-loss / double-dispose may null materials before we run.
      if (c.line) {
        group.remove(c.line);
        c.line.geometry?.dispose?.();
        const lm = c.line.material as THREE.Material | null | undefined;
        if (lm && typeof lm.dispose === "function") lm.dispose();
      }
      if (c.head) {
        group.remove(c.head);
        c.head.geometry?.dispose?.();
        const hm = c.head.material as THREE.Material | null | undefined;
        if (hm && typeof hm.dispose === "function") hm.dispose();
      }
    }
    comets.length = 0;
    lines.length = 0;
    heads.length = 0;
    if (sprite) releaseHeadSprite();
    scene.remove(group);
  };

  return handle;
}

/**
 * Hacker c23: the scene's 5s sync did `comets.dispose(); comets = createCommitComets(...)`
 * unconditionally — 2 geometries + 2 materials per comet freed and re-created every 5s
 * even when the commit list was unchanged. Disposing the last LineBasicMaterial(vertexColors)
 * / PointsMaterial lets three release (and next frame recompile) the shader programs, plus
 * fresh GPU buffer uploads: a periodic hitch with nothing new to show.
 *
 * `syncCommitComets` returns `prev` untouched when the derived comet list (commitCometKeys)
 * and options are unchanged; otherwise disposes `prev` and builds a new handle.
 * Callers compare the returned handle to decide whether to reconcile launches (or just
 * always call reconcileCometLaunch — it is a no-op for unchanged keys).
 */
export function syncCommitComets(
  scene: THREE.Scene,
  prev: CommitCometsHandle | null | undefined,
  commits: readonly CommitTrailInput[] | null | undefined,
  opts: CreateCommitCometsOpts | null | undefined = {},
): CommitCometsHandle {
  // Hacker c24: non-object opts (null already ??'d) must not throw on o.max.
  const o = opts && typeof opts === "object" ? opts : {};
  if (prev && !prev.disposed && prev.group.parent === scene) {
    const meta = syncMeta.get(prev);
    if (meta) {
      const max = clampInt(o.max ?? COMET_MAX_DEFAULT, 0, COMET_MAX_HARD, COMET_MAX_DEFAULT);
      const radius = Math.max(0.01, finiteOr(o.radius ?? 14, 14));
      const segments = clampInt(o.segments ?? COMET_SEGMENTS_DEFAULT, COMET_SEGMENTS_MIN, 128, COMET_SEGMENTS_DEFAULT);
      const clock = o.clock ?? sharedMotionClock;
      if (meta.max === max && meta.radius === radius && meta.segments === segments && meta.clock === clock) {
        const next = commitCometKeys(commits, max);
        const cur = prev.shas ?? [];
        let same = next.length === cur.length;
        for (let i = 0; same && i < next.length; i++) same = next[i] === cur[i];
        if (same) return prev;
      }
    }
  }
  prev?.dispose();
  return createCommitComets(scene, commits, o);
}

/** Scene opacity scales the launch ease multiplies (match universe-scene c22 wiring). */
export const COMET_LAUNCH_LINE_OPACITY = 0.55;
export const COMET_LAUNCH_LINE_OPACITY_REDUCED = 0.22;
export const COMET_LAUNCH_HEAD_OPACITY = 0.95;
export const COMET_LAUNCH_HEAD_OPACITY_REDUCED = 0.35;

/**
 * c24: apply comet-launch samples to the comet meshes in one call — replaces the scene's
 * per-frame loop that did two `group.getObjectByName` tree walks per comet per frame
 * (string build + traversal) and repeated the opacity / cometHeadSize math inline.
 * Same output as that loop: visible = sample.visible || reduced; line opacity
 * 0.55·opacity (reduced 0.22); head opacity 0.95·opacity (reduced 0.35);
 * head size = cometHeadSize(head.userData.baseSize). Missing / short samples hide that
 * comet (never NaN); disposed handle → 0. Hacker c25: null/hole/missing-material
 * slots in lines/heads are skipped (stale cache after sync/context-loss) — never throw.
 * Returns how many comets are visible. No alloc.
 */
export function applyCometLaunchSamples(
  handle: CommitCometsHandle | null | undefined,
  samples: ReadonlyArray<Readonly<CometLaunchSample> | null | undefined> | null | undefined,
  reducedMotion: boolean,
): number {
  if (!handle || handle.disposed) return 0;
  const lines = handle.lines;
  const heads = handle.heads;
  if (!lines || !heads) return 0;
  const n = Math.max(0, Math.min(handle.count | 0, lines.length, heads.length));
  const list = Array.isArray(samples) ? samples : null;
  let visibleCount = 0;
  for (let i = 0; i < n; i++) {
    const sample = list ? list[i] : null;
    const line = lines[i];
    const head = heads[i];
    // Hacker c25: sparse / stale cache after sync, dispose, or WebGL context-loss.
    if (!line || !head) continue;
    const lm = line.material as THREE.LineBasicMaterial | null | undefined;
    const hm = head.material as THREE.PointsMaterial | null | undefined;
    if (!lm || !hm) continue;
    const op = sample ? finiteOr(sample.opacity, 0) : 0;
    const vis = reducedMotion || (sample ? sample.visible === true : false);
    const k = reducedMotion ? 1 : op < 0 ? 0 : op > 1 ? 1 : op;
    line.visible = vis;
    head.visible = vis;
    lm.opacity = (reducedMotion ? COMET_LAUNCH_LINE_OPACITY_REDUCED : COMET_LAUNCH_LINE_OPACITY) * k;
    hm.opacity = (reducedMotion ? COMET_LAUNCH_HEAD_OPACITY_REDUCED : COMET_LAUNCH_HEAD_OPACITY) * k;
    const base = typeof head.userData.baseSize === "number" ? head.userData.baseSize : hm.size;
    hm.size = cometHeadSize(base as number, sample ?? null, reducedMotion);
    if (vis) visibleCount++;
  }
  return visibleCount;
}
