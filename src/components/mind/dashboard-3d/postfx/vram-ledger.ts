/**
 * #120 postfx VRAM ledger (Cosmos Light Bot).
 *
 * One honest readout of the render-target bytes the postfx stack holds right
 * now: composer read/write buffers (+ depth), the UnrealBloom mip chain, the
 * #114 god-ray emission mask and the backdrop-meter readback target. Bytes are
 * computed from each target's real width × height × texel type/format (what
 * three.js asks the driver for — drivers may pad; that is not guessed at).
 *
 * Sources self-register (bloom-tuning, god-rays, backdrop-meter) and capture
 * the renderer they last rendered with, so no scene wiring is needed: the
 * `?dash3dDebug=1` meter badge appends `postfxVramLedger()` automatically.
 *
 * "allocated" basis: when the renderer exposes three's `properties`, a target
 * only counts while it really owns a framebuffer (three frees it on
 * `rt.dispose()` / `setSize` and re-allocates on next bind). Without a real
 * renderer (tests, before first frame) the basis is "declared" (sized targets).
 * Targets are de-duplicated by identity across sources (two bloom handles that
 * see the same composer buffers count them once).
 */
import * as THREE from "three";

export type VramSourceName = "composer" | "bloom" | "rays" | "meter";
export const VRAM_SOURCE_ORDER: readonly VramSourceName[] = ["composer", "bloom", "rays", "meter"];

type PropertiesLike = { has?: (o: object) => boolean; get?: (o: object) => Record<string, unknown> };
export type VramRendererLike = { properties?: PropertiesLike } | null | undefined;

export type VramSourceSnapshot = {
  targets: readonly (THREE.WebGLRenderTarget | null | undefined)[];
  renderer?: VramRendererLike;
};
export type VramSource = () => VramSourceSnapshot | null;

export type PostfxVramLedger = {
  /** Sum over all live, de-duplicated targets (bytes). */
  total: number;
  bySource: Record<VramSourceName, number>;
  /** Targets counted. */
  targets: number;
  /** "allocated" when every counted source had a real renderer to ask. */
  basis: "allocated" | "declared" | "mixed" | "none";
};

const CHANNELS: Record<number, number> = {
  [THREE.RGBAFormat]: 4,
  [THREE.RGBAIntegerFormat]: 4,
  [THREE.RGFormat]: 2,
  [THREE.RGIntegerFormat]: 2,
  [THREE.RedFormat]: 1,
  [THREE.RedIntegerFormat]: 1,
  [THREE.AlphaFormat]: 1,
};

/** Bytes per component for a three texture data type (0 = unknown → not counted). */
export function componentBytes(type: THREE.TextureDataType | undefined | null): number {
  switch (type) {
    case THREE.UnsignedByteType:
    case THREE.ByteType:
      return 1;
    case THREE.HalfFloatType:
    case THREE.ShortType:
    case THREE.UnsignedShortType:
      return 2;
    case THREE.FloatType:
    case THREE.IntType:
    case THREE.UnsignedIntType:
      return 4;
    default:
      return 0;
  }
}

/** Bytes per texel for a colour texture (RGBA HalfFloat = 8, RGBA byte = 4). */
export function texelBytes(texture: Pick<THREE.Texture, "type" | "format"> | null | undefined): number {
  if (!texture) return 0;
  const ch = CHANNELS[texture.format as number] ?? 0;
  return ch * componentBytes(texture.type);
}

const finiteEdge = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 0);

/** Depth bytes per texel: DepthTexture by its type; plain depth renderbuffer = 24-bit (+8 stencil) → 4. */
function depthTexelBytes(rt: THREE.WebGLRenderTarget): number {
  const dt = rt.depthTexture;
  if (dt) {
    if (dt.type === THREE.UnsignedShortType) return 2;
    if (dt.type === THREE.FloatType && dt.format === THREE.DepthStencilFormat) return 8;
    return 4;
  }
  return rt.depthBuffer ? 4 : 0;
}

/**
 * Requested bytes for one render target: every colour attachment + depth
 * (texture or renderbuffer); MSAA adds `samples` multisampled colour and depth
 * renderbuffers on top of the resolve texture. 0 for unsized / unknown types.
 */
export function renderTargetBytes(rt: THREE.WebGLRenderTarget | null | undefined): number {
  if (!rt) return 0;
  const w = finiteEdge(rt.width);
  const h = finiteEdge(rt.height);
  if (!w || !h) return 0;
  const px = w * h;
  const textures = (rt.textures?.length ? rt.textures : [rt.texture]).filter(Boolean);
  let color = 0;
  for (const t of textures) color += px * texelBytes(t);
  const samples = finiteEdge(rt.samples);
  const depth = px * depthTexelBytes(rt);
  // MSAA: three adds multisampled colour + depth renderbuffers beside the resolve targets.
  return color + depth + (samples > 0 ? samples * (color + depth) : 0);
}

/**
 * Does the GPU currently hold storage for `rt`? true / false from three's
 * renderer properties; null when the renderer can't say (declared basis).
 */
export function renderTargetAllocated(renderer: VramRendererLike, rt: THREE.WebGLRenderTarget): boolean | null {
  const p = renderer?.properties;
  if (!p || typeof p.has !== "function" || typeof p.get !== "function") return null;
  try {
    if (!p.has(rt)) return false;
    return p.get(rt).__webglFramebuffer !== undefined;
  } catch {
    return null;
  }
}

const registry = new Map<number, { name: VramSourceName; read: VramSource }>();
let nextId = 1;

/** Register a live source; returns the unregister function (call it on dispose). */
export function registerVramSource(name: VramSourceName, read: VramSource): () => void {
  const id = nextId++;
  registry.set(id, { name, read });
  return () => {
    registry.delete(id);
  };
}

/** Live registered source count (tests / badge gating). */
export const vramSourceCount = () => registry.size;

const emptyBySource = (): Record<VramSourceName, number> => ({ composer: 0, bloom: 0, rays: 0, meter: 0 });

/** Measure explicit sources (pure) — same rules as the registry readout. */
export function measurePostfxVram(
  sources: readonly { name: VramSourceName; snapshot: VramSourceSnapshot | null }[],
): PostfxVramLedger {
  const seen = new Set<THREE.WebGLRenderTarget>();
  const bySource = emptyBySource();
  let total = 0;
  let targets = 0;
  let allocated = 0;
  let declared = 0;
  for (const { name, snapshot } of sources) {
    if (!snapshot) continue;
    for (const rt of snapshot.targets) {
      if (!rt || seen.has(rt)) continue;
      const live = renderTargetAllocated(snapshot.renderer, rt);
      if (live === false) continue;
      const bytes = renderTargetBytes(rt);
      if (!bytes) continue;
      seen.add(rt);
      if (live === null) declared++;
      else allocated++;
      bySource[name] += bytes;
      total += bytes;
      targets++;
    }
  }
  const basis = targets === 0 ? "none" : declared === 0 ? "allocated" : allocated === 0 ? "declared" : "mixed";
  return { total, bySource, targets, basis };
}

/** Ledger over every registered (live) postfx source. A throwing source is skipped, never fatal. */
export function postfxVramLedger(): PostfxVramLedger {
  const list: { name: VramSourceName; snapshot: VramSourceSnapshot | null }[] = [];
  for (const { name, read } of registry.values()) {
    let snapshot: VramSourceSnapshot | null = null;
    try {
      snapshot = read();
    } catch {
      snapshot = null;
    }
    list.push({ name, snapshot });
  }
  // Stable order so the composer claims its shared buffers before anyone else.
  list.sort((a, b) => VRAM_SOURCE_ORDER.indexOf(a.name) - VRAM_SOURCE_ORDER.indexOf(b.name));
  return measurePostfxVram(list);
}

/** Total live postfx render-target bytes. */
export const postfxVramBytes = () => postfxVramLedger().total;

const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);

/** Badge segment: "vram 41.3 MB (composer 33.2 · bloom 8.1 · rays 0.0 · meter 0.0)"; basis noted when not allocated. */
export function formatVramBadge(ledger: PostfxVramLedger | null | undefined): string {
  if (!ledger || ledger.basis === "none") return "vram 0.0 MB";
  const parts = VRAM_SOURCE_ORDER.map((n) => `${n} ${mb(ledger.bySource[n])}`).join(" · ");
  const basis = ledger.basis === "allocated" ? "" : ` ${ledger.basis}`;
  return `vram ${mb(ledger.total)} MB${basis} (${parts})`;
}
