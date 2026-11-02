import * as THREE from "three";
import type { PainterlyKit } from "./use-painterly-kit.ts";
import {
  buildInkWashRibbon,
  setInkWashEdgeHealth,
  setInkWashEdgeBleed,
  inkBleedFromWeight,
  tickInkWashEdgeMaterial,
  isDegenerateInkEdge,
  INK_EDGES_MAX,
  INK_EDGE_DEGENERATE_EPS,
  type HealthTone,
  type InkWashRibbonOptions,
} from "./ink-wash-edge.ts";
import { PAINTER_RENDER_ORDER, applyPainterTransparentLayer } from "./painter-depth.ts";
import { sanitizeFinite } from "./paper-grain.ts";

/** Local release — avoid value-import cycle with use-painterly-kit. */
function releaseTrackedInkMaterial(kit: PainterlyKit, mat: THREE.ShaderMaterial): void {
  const i = kit.tracked.indexOf(mat);
  if (i >= 0) kit.tracked.splice(i, 1);
  for (let b = kit.textureBindings.length - 1; b >= 0; b--) {
    if (kit.textureBindings[b]!.material === mat) kit.textureBindings.splice(b, 1);
  }
  mat.dispose();
}

export type PainterlyInkEdgeInput = {
  from: readonly [number, number, number] | { x: number; y: number; z: number };
  to: readonly [number, number, number] | { x: number; y: number; z: number };
  health?: HealthTone | string;
  kind?: "hub" | "link" | string;
  /** Optional real edge weight/activity (0..2). Drives uBleed when set. */
  weight?: number;
  /** Optional stable id for diffing updates. */
  id?: string;
};

export type PainterlyInkEdgesOptions = {
  /** Cap edges processed (default INK_EDGES_MAX). */
  maxEdges?: number;
  ribbon?: InkWashRibbonOptions;
  hubWidth?: number;
  linkWidth?: number;
  hubPulse?: number;
  linkPulse?: number;
};

export type PainterlyInkEdgesHandle = {
  /** Scene graph node — add to edgeGroup / scene. */
  group: THREE.Group;
  /** Replace all ribbons from a new edge list (disposes prior GPU geo). */
  update: (edges: PainterlyInkEdgeInput[]) => void;
  /** Tick shared materials (also covered by tickPainterlyKit if kit-tracked). */
  tick: (timeSeconds: number) => void;
  /** Release materials from kit + dispose geometries. Idempotent. */
  dispose: () => void;
  edgeCount: number;
  skippedDegenerate: number;
  truncated: boolean;
  drawCalls: number;
};

const TONES: HealthTone[] = ["healthy", "stalled", "blocked", "idle"];

function asTone(h: unknown): HealthTone {
  if (h === "healthy" || h === "stalled" || h === "blocked" || h === "idle") return h;
  return "idle";
}

/**
 * Merge many ribbons into one BufferGeometry (single draw call).
 * HACKER: skips degenerate/zero-length/NaN edges; caps count.
 */
export function buildMergedInkWashGeometry(
  edges: PainterlyInkEdgeInput[],
  opts: {
    widthFor: (e: PainterlyInkEdgeInput) => number;
    segments?: number;
    arc?: number;
  },
): { geometry: THREE.BufferGeometry; used: number; skippedDegenerate: number } {
  const segments = Math.floor(sanitizeFinite(opts.segments ?? 16, 16, 1, 64));
  const arc = sanitizeFinite(opts.arc ?? 0.05, 0.05, -0.5, 0.5);
  const geos: THREE.BufferGeometry[] = [];
  let used = 0;
  let skippedDegenerate = 0;
  for (const e of edges) {
    if (isDegenerateInkEdge(e.from, e.to, INK_EDGE_DEGENERATE_EPS)) {
      skippedDegenerate += 1;
      continue;
    }
    const g = buildInkWashRibbon(e.from, e.to, {
      width: opts.widthFor(e),
      segments,
      arc,
    });
    geos.push(g);
    used += 1;
  }
  if (geos.length === 0) {
    const empty = new THREE.BufferGeometry();
    return { geometry: empty, used: 0, skippedDegenerate };
  }
  // three.js mergeGeometries via BufferGeometryUtils may not be imported — merge manually
  const merged = mergeRibbonGeometries(geos);
  for (const g of geos) g.dispose();
  return { geometry: merged, used, skippedDegenerate };
}

function mergeRibbonGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let posCount = 0;
  let idxCount = 0;
  for (const g of geos) {
    posCount += g.getAttribute("position").count;
    idxCount += g.getIndex()!.count;
  }
  const pos = new Float32Array(posCount * 3);
  const tan = new Float32Array(posCount * 3);
  const side = new Float32Array(posCount);
  const uv = new Float32Array(posCount * 2);
  const index = new Uint32Array(idxCount);
  let po = 0;
  let io = 0;
  let vertexBase = 0;
  let maxR = 0;
  for (const g of geos) {
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const t = g.getAttribute("aTangent") as THREE.BufferAttribute;
    const s = g.getAttribute("aSide") as THREE.BufferAttribute;
    const u = g.getAttribute("uv") as THREE.BufferAttribute;
    const idx = g.getIndex()!;
    for (let i = 0; i < p.count; i++) {
      pos[po * 3] = p.getX(i);
      pos[po * 3 + 1] = p.getY(i);
      pos[po * 3 + 2] = p.getZ(i);
      tan[po * 3] = t.getX(i);
      tan[po * 3 + 1] = t.getY(i);
      tan[po * 3 + 2] = t.getZ(i);
      side[po] = s.getX(i);
      uv[po * 2] = u.getX(i);
      uv[po * 2 + 1] = u.getY(i);
      po += 1;
    }
    for (let i = 0; i < idx.count; i++) {
      index[io++] = vertexBase + idx.getX(i);
    }
    vertexBase += p.count;
    g.computeBoundingSphere();
    if (g.boundingSphere) maxR = Math.max(maxR, g.boundingSphere.radius + g.boundingSphere.center.length());
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("aTangent", new THREE.BufferAttribute(tan, 3));
  out.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  if (out.boundingSphere) out.boundingSphere.radius = Math.max(out.boundingSphere.radius, maxR);
  return out;
}

/**
 * One-call ink-wash constellation edges for Dashboard Bot `rebuildEdges`.
 *
 * Batches by health tone → **≤4 draw calls** regardless of edge count (until maxEdges).
 * Shared materials are kit-tracked; dispose via handle.dispose() / releasePainterlyMaterial.
 *
 * ```ts
 * const ink = kit.createInkEdges(edges.map(e => ({
 *   from: posOf(e.from), to: posOf(e.to), health: e.health, kind: e.kind,
 * })));
 * edgeGroup.add(ink.group);
 * // on status poll: ink.update(nextEdges);
 * // cleanup: ink.dispose();
 * ```
 */
export function createPainterlyInkEdges(
  kit: PainterlyKit,
  edges: PainterlyInkEdgeInput[] = [],
  opts: PainterlyInkEdgesOptions = {},
): PainterlyInkEdgesHandle {
  const group = new THREE.Group();
  group.name = "PainterlyInkEdges";
  const materials = new Map<HealthTone, THREE.ShaderMaterial>();
  const meshes = new Map<HealthTone, THREE.Mesh>();
  let disposed = false;
  let edgeCount = 0;
  let skippedDegenerate = 0;
  let truncated = false;
  let drawCalls = 0;

  const hubWidth = sanitizeFinite(opts.hubWidth ?? 0.22, 0.22, 0.01, 8);
  const linkWidth = sanitizeFinite(opts.linkWidth ?? 0.34, 0.34, 0.01, 8);
  const hubPulse = sanitizeFinite(opts.hubPulse ?? 0.2, 0.2, 0, 1);
  const linkPulse = sanitizeFinite(opts.linkPulse ?? 0.45, 0.45, 0, 1);
  const maxEdges = Math.floor(
    sanitizeFinite(opts.maxEdges ?? INK_EDGES_MAX, INK_EDGES_MAX, 1, INK_EDGES_MAX),
  );

  for (const tone of TONES) {
    const mat = kit.createInkWashEdgeMaterial({
      health: tone,
      pulse: linkPulse,
      bleed: inkBleedFromWeight(tone, "link"),
    });
    materials.set(tone, mat);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    mesh.frustumCulled = true;
    mesh.renderOrder = PAINTER_RENDER_ORDER.inkEdge;
    applyPainterTransparentLayer(mat, "inkEdge", mesh);
    mesh.userData.inkEdgeBatch = tone;
    mesh.visible = false;
    meshes.set(tone, mesh);
    group.add(mesh);
  }

  const clearGeos = () => {
    for (const mesh of meshes.values()) {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.BufferGeometry();
      mesh.visible = false;
    }
  };

  const update = (next: PainterlyInkEdgeInput[]) => {
    if (disposed) return;
    const arr = Array.isArray(next) ? next : [];
    truncated = arr.length > maxEdges;
    const slice = truncated ? arr.slice(0, maxEdges) : arr;
    // bucket by tone
    const buckets: Record<HealthTone, PainterlyInkEdgeInput[]> = {
      healthy: [],
      stalled: [],
      blocked: [],
      idle: [],
    };
    skippedDegenerate = 0;
    for (const e of slice) {
      if (isDegenerateInkEdge(e.from, e.to)) {
        skippedDegenerate += 1;
        continue;
      }
      buckets[asTone(e.health)].push(e);
    }
    edgeCount = 0;
    drawCalls = 0;
    for (const tone of TONES) {
      const list = buckets[tone];
      const mesh = meshes.get(tone)!;
      const mat = materials.get(tone)!;
      mesh.geometry.dispose();
      if (list.length === 0) {
        mesh.geometry = new THREE.BufferGeometry();
        mesh.visible = false;
        continue;
      }
      // hub vs link width per edge inside merge
      const built = buildMergedInkWashGeometry(list, {
        widthFor: (e) => (e.kind === "hub" ? hubWidth : linkWidth),
        segments: opts.ribbon?.segments ?? 16,
        arc: opts.ribbon?.arc ?? 0.05,
      });
      skippedDegenerate += built.skippedDegenerate;
      edgeCount += built.used;
      mesh.geometry = built.geometry;
      mesh.visible = built.used > 0;
      // pulse: hubs a bit calmer — approximate with linkPulse; per-edge pulse isn't in shared mat
      setInkWashEdgeHealth(mat, tone);
      mat.uniforms["uPulse"]!.value = list.some((e) => e.kind === "hub") && list.every((e) => e.kind === "hub")
        ? hubPulse
        : linkPulse;
      // c13: watercolor bleed from real health/kind/weight (average over batch)
      let bleedSum = 0;
      for (const e of list) {
        if (e.weight != null) {
          bleedSum += sanitizeFinite(0.15 + sanitizeFinite(e.weight, 0.5, 0, 2) * 0.5, 0.4, 0, 1.5);
        } else {
          bleedSum += inkBleedFromWeight(tone, e.kind);
        }
      }
      setInkWashEdgeBleed(mat, list.length ? bleedSum / list.length : inkBleedFromWeight(tone));
      if (built.used > 0) drawCalls += 1;
    }
  };

  const tick = (timeSeconds: number) => {
    if (disposed) return;
    for (const mat of materials.values()) tickInkWashEdgeMaterial(mat, timeSeconds);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearGeos();
    for (const mat of materials.values()) {
      releaseTrackedInkMaterial(kit, mat);
    }
    materials.clear();
    meshes.clear();
    while (group.children.length) group.remove(group.children[0]!);
  };

  update(edges);

  return {
    group,
    update,
    tick,
    dispose,
    get edgeCount() {
      return edgeCount;
    },
    get skippedDegenerate() {
      return skippedDegenerate;
    },
    get truncated() {
      return truncated;
    },
    get drawCalls() {
      return drawCalls;
    },
  };
}
