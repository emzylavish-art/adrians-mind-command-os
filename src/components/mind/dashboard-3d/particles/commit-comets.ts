import * as THREE from "three";
import { clampInt, finiteOr } from "../motion/sanitize.ts";
import { sharedMotionClock, type MotionClock } from "../motion/motion-clock.ts";
import { isDocumentHidden } from "./motion-lod.ts";

export const COMET_SEGMENTS_MIN = 2;
export const COMET_SEGMENTS_DEFAULT = 24;
export const COMET_MAX_DEFAULT = 6;
export const COMET_MAX_HARD = 24;

export type CommitTrailInput = {
  sha?: string | null;
  subject?: string;
};

export type CommitCometsHandle = {
  group: THREE.Group;
  count: number;
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

function hashHue(sha: string): number {
  let h = 0;
  for (let i = 0; i < sha.length; i++) h = (h * 33 + sha.charCodeAt(i)) | 0;
  return (h >>> 0) % 360;
}

/**
 * Commit → comet trails. segments clamped ≥2 (avoids /0 → NaN arcs).
 * dispose() idempotent; update() after dispose is a no-op.
 * Skips commits with empty/missing sha rather than fabricating.
 */
export function createCommitComets(
  scene: THREE.Scene,
  commits: readonly CommitTrailInput[] | null | undefined,
  opts: CreateCommitCometsOpts = {},
): CommitCometsHandle {
  const max = clampInt(opts.max ?? COMET_MAX_DEFAULT, 0, COMET_MAX_HARD, COMET_MAX_DEFAULT);
  const radius = Math.max(0.01, finiteOr(opts.radius ?? 14, 14));
  const segments = clampInt(opts.segments ?? COMET_SEGMENTS_DEFAULT, COMET_SEGMENTS_MIN, 128, COMET_SEGMENTS_DEFAULT);
  const clock = opts.clock ?? sharedMotionClock;
  const group = new THREE.Group();
  group.name = "motion-commit-comets";
  scene.add(group);

  const raw = Array.isArray(commits) ? commits : [];
  const list = raw
    .filter((c) => c && typeof c.sha === "string" && c.sha.length > 0)
    .slice(0, max);

  const comets: CometState[] = [];
  const handle: CommitCometsHandle = {
    group,
    count: 0,
    disposed: false,
    update: () => {},
    dispose: () => {},
  };

  const sprite = list.length > 0 ? acquireHeadSprite() : null;
  list.forEach((c, i) => {
    const positions = new Float32Array(segments * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const hue = hashHue(c.sha!);
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
    group.add(head);
    comets.push({
      phase: i * 1.7,
      speed: 0.22 + (i % 3) * 0.05,
      incline: 0.25 + (i % 4) * 0.08,
      yaw: (i / Math.max(list.length, 1)) * Math.PI * 2,
      color: color.getHex(),
      line,
      positions,
      head,
      headPos,
    });
  });
  handle.count = comets.length;

  const writeArc = (c: CometState, head: number) => {
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
    const attr = c.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
    c.headPos[0] = pos[0]!;
    c.headPos[1] = pos[1]!;
    c.headPos[2] = pos[2]!;
    (c.head.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  };

  const setOpacity = (c: CometState, line: number, head: number) => {
    (c.line.material as THREE.LineBasicMaterial).opacity = line;
    (c.head.material as THREE.PointsMaterial).opacity = head;
  };

  for (const c of comets) writeArc(c, c.phase);

  handle.update = (tSeconds: number, reducedMotion: boolean) => {
    if (handle.disposed) return;
    if (reducedMotion) {
      for (const c of comets) setOpacity(c, LINE_OPACITY_REDUCED, HEAD_OPACITY_REDUCED);
      return;
    }
    if (isDocumentHidden()) return;
    const t = clock.map(tSeconds);
    for (const c of comets) {
      setOpacity(c, LINE_OPACITY, HEAD_OPACITY);
      writeArc(c, t * c.speed + c.phase);
    }
  };

  handle.dispose = () => {
    if (handle.disposed) return;
    handle.disposed = true;
    for (const c of comets) {
      group.remove(c.line);
      c.line.geometry.dispose();
      (c.line.material as THREE.Material).dispose();
      group.remove(c.head);
      c.head.geometry.dispose();
      (c.head.material as THREE.Material).dispose();
    }
    comets.length = 0;
    if (sprite) releaseHeadSprite();
    scene.remove(group);
  };

  return handle;
}
