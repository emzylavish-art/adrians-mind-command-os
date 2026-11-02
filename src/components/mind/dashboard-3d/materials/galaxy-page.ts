/**
 * Painter c30 — Notion page galaxy adopt (InstancedMesh watercolor + ink child edges).
 * Replaces MeshBasicMaterial interim (dashboard c68) when Dashboard wires rebuildPages.
 */
import * as THREE from "three";
import type { PainterlyKit } from "./use-painterly-kit.ts";
import { GalaxyPageShader, GALAXY_PAGE_DEFAULT_RGB } from "../shaders/galaxy-page.ts";
import { PAINTER_SHADER_PRECISION } from "../shaders/glsl-noise.ts";
import {
  applyPainterOutputSafeFlags,
  painterPigmentFromStatusColor,
  sanitizePainterEmissive,
  sanitizeStarGrain,
  sanitizeStarHalo,
  PAINTER_MATTE_DEFAULT,
} from "./painter-output.ts";
import { sanitizeFinite, sanitizeShaderTime } from "./paper-grain.ts";
import {
  createPainterlyInkEdges,
  type PainterlyInkEdgeInput,
  type PainterlyInkEdgesHandle,
} from "./painterly-ink-edges.ts";
import { PAINTER_RENDER_ORDER, applyPainterTransparentLayer } from "./painter-depth.ts";


/** Fibonacci sphere — mirrors notion-graph-core.pageStarPositions (lane-local, no @ alias). */
function pageStarPositions(count: number, radius = 14): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const n = Math.max(0, Math.floor(count));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(n - 1, 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push([Math.cos(theta) * r * radius, y * radius * 0.55 + 2, Math.sin(theta) * r * radius]);
  }
  return out;
}

export const GALAXY_PAGES_MAX = 512;
export const GALAXY_PAGE_EDGES_MAX = 160;
export const GALAXY_PAGE_RADIUS_DEFAULT = 0.12;

export type GalaxyPageKind = "page" | "database" | "other";

export type GalaxyPageInput = {
  id: string;
  kind?: string | null;
  /** Optional world position; omit → fibonacci sphere via pageStarPositions. */
  position?: readonly [number, number, number] | null;
};

export type GalaxyEdgeInput = {
  from: string;
  to: string;
  kind?: string | null;
};

export type GalaxyPageMaterialOptions = {
  color?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  grain?: number;
  stroke?: number;
  halo?: number;
  matte?: number;
  forceFallback?: boolean;
};

/** Map real NotionSnapPage.kind → pigment hex (snapshot-driven, no fabricated status). */
export function galaxyPigmentFromPageKind(kind?: string | null): number {
  const k = (kind ?? "page").toLowerCase();
  if (k.includes("database") || k.includes("db")) return 0x7c5cff; // indigo wash
  if (k.includes("board") || k.includes("collection")) return 0x5b9fd4;
  if (k.includes("canvas") || k.includes("wiki")) return 0x6eb5a0;
  return 0x9bb7ff; // default page star (matches prior MeshBasic)
}

export function asGalaxyPageKind(kind?: string | null): GalaxyPageKind {
  const k = (kind ?? "").toLowerCase();
  if (k.includes("database") || k.includes("db")) return "database";
  if (!k || k === "page") return "page";
  return "other";
}

function galaxyFallbackMaterial(color: THREE.Color, reason: string): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    name: "GalaxyPageMaterialFallback",
    uniforms: {
      uColor: { value: color.clone() },
      uEmissive: { value: 0.4 },
      uTime: { value: 0 },
      uGrain: { value: 0 },
      uStroke: { value: 0 },
      uHalo: { value: 0 },
      uMatte: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vInstanceColor;
      attribute vec3 instanceColor;
      void main() {
        #ifdef USE_INSTANCING
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
        #endif
        #ifdef USE_INSTANCING_COLOR
          vInstanceColor = instanceColor;
        #else
          vInstanceColor = vec3(1.0);
        #endif
        if (!(vInstanceColor.r == vInstanceColor.r)) vInstanceColor = vec3(1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec3 vInstanceColor;
      void main() {
        vec3 c = uColor * vInstanceColor;
        c = clamp(c, 0.0, 0.92);
        gl_FragColor = vec4(c, 0.9);
      }
    `,
    transparent: true,
    depthWrite: true,
    precision: PAINTER_SHADER_PRECISION,
  });
  applyPainterOutputSafeFlags(mat, { transparent: true, premultipliedAlpha: true });
  mat.userData.painterMaterialMeta = { compileError: reason, fallback: true };
  // Enable instance color path when InstancedMesh provides it
  mat.defines = { ...(mat.defines ?? {}), USE_INSTANCING_COLOR: "" };
  return mat;
}

/** Watercolor ShaderMaterial for Notion page InstancedMesh (instanceColor-safe). */
export function createGalaxyPageMaterial(opts: GalaxyPageMaterialOptions = {}): THREE.ShaderMaterial {
  const pig = painterPigmentFromStatusColor(opts.color ?? 0x9bb7ff, {
    fallback: new THREE.Color(GALAXY_PAGE_DEFAULT_RGB[0], GALAXY_PAGE_DEFAULT_RGB[1], GALAXY_PAGE_DEFAULT_RGB[2]),
  });
  if (opts.forceFallback) {
    return galaxyFallbackMaterial(pig.color, "forceFallback");
  }
  try {
    if (!GalaxyPageShader.vertexShader?.trim() || !GalaxyPageShader.fragmentShader?.trim()) {
      throw new Error("galaxy-page-shader-empty");
    }
    const uniforms = {
      uColor: { value: pig.color.clone() },
      uEmissive: {
        value: sanitizePainterEmissive(opts.emissiveIntensity ?? 0.45, 0.45),
      },
      uTime: { value: 0 },
      uGrain: { value: sanitizeStarGrain(opts.grain ?? 0.28, 0.28) },
      uStroke: { value: sanitizeFinite(opts.stroke ?? 0.4, 0.4, 0, 1) },
      uHalo: { value: sanitizeStarHalo(opts.halo ?? 0.35, 0.35) },
      uMatte: {
        value: sanitizeFinite(opts.matte ?? Math.max(PAINTER_MATTE_DEFAULT, 0.9), 0.9, 0, 1),
      },
    };
    const mat = new THREE.ShaderMaterial({
      name: "GalaxyPageMaterial",
      uniforms,
      vertexShader: GalaxyPageShader.vertexShader,
      fragmentShader: GalaxyPageShader.fragmentShader,
      transparent: true,
      depthWrite: true,
      precision: PAINTER_SHADER_PRECISION,
    });
    // Declare instanceColor attribute path for InstancedMesh.instanceColor
    mat.defines = { ...(mat.defines ?? {}), USE_INSTANCING_COLOR: "" };
    applyPainterOutputSafeFlags(mat, { transparent: true, premultipliedAlpha: true });
    mat.userData.painterMaterialMeta = { compileError: null, fallback: false };
    if (!pig.ok) mat.userData.starColorError = pig.reason;
    return mat;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return galaxyFallbackMaterial(pig.color, reason);
  }
}

export function tickGalaxyPageMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) {
    mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
  }
}

export type NotionGalaxyPagesHandle = {
  group: THREE.Group;
  pageMesh: THREE.InstancedMesh | null;
  edges: PainterlyInkEdgesHandle | null;
  update: (pages: GalaxyPageInput[], edges?: GalaxyEdgeInput[]) => void;
  dispose: () => void;
  pageCount: number;
  edgeCount: number;
  truncated: boolean;
  skippedInvalid: number;
};

export type NotionGalaxyPagesOptions = {
  /** Fibonacci sphere radius (default 16 — matches universe-scene). */
  layoutRadius?: number;
  pageRadius?: number;
  maxPages?: number;
  maxEdges?: number;
  material?: GalaxyPageMaterialOptions;
};

/**
 * One-call Notion galaxy for Dashboard `rebuildPages`.
 * Real snapshot pages → kind pigment; child edges → ink-wash ribbons.
 */
export function createNotionGalaxyPages(
  kit: PainterlyKit,
  pages: GalaxyPageInput[] = [],
  edges: GalaxyEdgeInput[] = [],
  opts: NotionGalaxyPagesOptions = {},
): NotionGalaxyPagesHandle {
  const group = new THREE.Group();
  group.name = "PainterlyNotionGalaxy";
  const maxPages = sanitizeFinite(opts.maxPages ?? GALAXY_PAGES_MAX, GALAXY_PAGES_MAX, 1, GALAXY_PAGES_MAX);
  const maxEdges = sanitizeFinite(opts.maxEdges ?? GALAXY_PAGE_EDGES_MAX, GALAXY_PAGE_EDGES_MAX, 0, 400);
  const layoutRadius = sanitizeFinite(opts.layoutRadius ?? 16, 16, 1, 64);
  const pageRadius = sanitizeFinite(opts.pageRadius ?? GALAXY_PAGE_RADIUS_DEFAULT, GALAXY_PAGE_RADIUS_DEFAULT, 0.04, 0.5);

  const mat = createGalaxyPageMaterial(opts.material);
  kit.tracked.push(mat);
  // Ensure tick updates uTime
  const prevTick = (mat as { userData: { galaxyTick?: boolean } }).userData;
  prevTick.galaxyTick = true;

  const geo = new THREE.SphereGeometry(pageRadius, 10, 10);
  let pageMesh: THREE.InstancedMesh | null = null;
  let ink: PainterlyInkEdgesHandle | null = null;
  let disposed = false;
  let pageCount = 0;
  let truncated = false;
  let skippedInvalid = 0;

  const rebuildMesh = (list: GalaxyPageInput[]) => {
    if (pageMesh) {
      group.remove(pageMesh);
      pageMesh.dispose();
      pageMesh = null;
    }
    const arr = Array.isArray(list) ? list : [];
    truncated = arr.length > maxPages;
    skippedInvalid = 0;
    const slice = truncated ? arr.slice(0, maxPages) : arr;
    const valid: { id: string; kind?: string | null; pos: [number, number, number] }[] = [];
    const fallbackPos = pageStarPositions(Math.max(slice.length, 1), layoutRadius);
    slice.forEach((p, i) => {
      if (!p || typeof p.id !== "string" || !p.id) {
        skippedInvalid += 1;
        return;
      }
      let pos: [number, number, number] | null = null;
      if (p.position && p.position.length >= 3) {
        const x = Number(p.position[0]);
        const y = Number(p.position[1]);
        const z = Number(p.position[2]);
        if ([x, y, z].every((n) => Number.isFinite(n))) pos = [x, y, z];
      }
      if (!pos) {
        const fp = fallbackPos[i] ?? fallbackPos[0]!;
        pos = [fp[0], fp[1], fp[2]];
      }
      valid.push({ id: p.id, kind: p.kind, pos });
    });
    pageCount = valid.length;
    if (!valid.length) return;

    pageMesh = new THREE.InstancedMesh(geo, mat, valid.length);
    pageMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(valid.length * 3), 3);
    pageMesh.renderOrder = PAINTER_RENDER_ORDER.star;
    applyPainterTransparentLayer(mat, "star", pageMesh);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    valid.forEach((p, i) => {
      dummy.position.set(p.pos[0], p.pos[1], p.pos[2]);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pageMesh!.setMatrixAt(i, dummy.matrix);
      const hex = galaxyPigmentFromPageKind(p.kind);
      const pig = painterPigmentFromStatusColor(hex, {
        fallback: new THREE.Color(GALAXY_PAGE_DEFAULT_RGB[0], GALAXY_PAGE_DEFAULT_RGB[1], GALAXY_PAGE_DEFAULT_RGB[2]),
      });
      col.copy(pig.color);
      pageMesh!.setColorAt(i, col);
    });
    pageMesh.instanceMatrix.needsUpdate = true;
    if (pageMesh.instanceColor) pageMesh.instanceColor.needsUpdate = true;
    // userData id map for focus tinting
    (pageMesh.userData as { pageIds?: string[] }).pageIds = valid.map((v) => v.id);
    (pageMesh.userData as { pagePositions?: [number, number, number][] }).pagePositions = valid.map((v) => v.pos);
    group.add(pageMesh);
  };

  const rebuildEdges = (edgeList: GalaxyEdgeInput[], idToPos: Map<string, [number, number, number]>) => {
    const inkEdges: PainterlyInkEdgeInput[] = [];
    const arr = Array.isArray(edgeList) ? edgeList : [];
    let n = 0;
    for (const e of arr) {
      if (!e || e.kind !== "child") continue;
      const a = idToPos.get(e.from);
      const b = idToPos.get(e.to);
      if (!a || !b) continue;
      inkEdges.push({ from: a, to: b, kind: "link", health: "idle", id: `${e.from}>${e.to}` });
      if (++n >= maxEdges) break;
    }
    if (!ink) {
      ink = createPainterlyInkEdges(kit, inkEdges, { maxEdges, linkWidth: 0.018 });
      group.add(ink.group);
    } else {
      ink.update(inkEdges);
    }
  };

  const update = (nextPages: GalaxyPageInput[], nextEdges: GalaxyEdgeInput[] = []) => {
    if (disposed) return;
    rebuildMesh(nextPages);
    const idToPos = new Map<string, [number, number, number]>();
    const ud = pageMesh?.userData as
      | { pageIds?: string[]; pagePositions?: [number, number, number][] }
      | undefined;
    const ids = ud?.pageIds ?? [];
    const positions = ud?.pagePositions ?? [];
    ids.forEach((id, i) => {
      const p = positions[i];
      if (p) idToPos.set(id, p);
    });
    rebuildEdges(nextEdges, idToPos);
  };

  update(pages, edges);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (pageMesh) {
      group.remove(pageMesh);
      pageMesh.dispose();
      pageMesh = null;
    }
    ink?.dispose();
    ink = null;
    const i = kit.tracked.indexOf(mat);
    if (i >= 0) kit.tracked.splice(i, 1);
    try {
      mat.dispose();
    } catch {
      /* */
    }
    try {
      geo.dispose();
    } catch {
      /* */
    }
  };

  return {
    group,
    get pageMesh() {
      return pageMesh;
    },
    get edges() {
      return ink;
    },
    update,
    dispose,
    get pageCount() {
      return pageCount;
    },
    get edgeCount() {
      return ink?.edgeCount ?? 0;
    },
    get truncated() {
      return truncated;
    },
    get skippedInvalid() {
      return skippedInvalid;
    },
  };
}
