/**
 * Queue #30 / Gap#8 / Gap#61 — project world XZ into a 0..1 minimap square.
 * Gap#61: auto-span from real bot positions + deterministic lane/id spread so
 * dots are not clumped on top of each other when lanes share a neighborhood.
 */

export type MinimapPoint = { id: string; x: number; y: number; health?: string; lane?: string };

export type MinimapBot = {
  id: string;
  pos: [number, number, number];
  health?: string;
  /** Real lane id when known (Gap#61). */
  lane?: string;
};

/** FNV-1a-ish 32-bit hash → [0,1). Stable across runs. */
export function hashUnit(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/** Minimum separation in map units after projection (before clamp). */
export const MINIMAP_MIN_SEP = 0.045;

/**
 * Fit span to real data (XZ), with a floor so a single bot does not explode.
 * Optional `span` override keeps Gap#8 behaviour for callers that pass one.
 */
export function spanFromPositions(
  bots: ReadonlyArray<{ pos: [number, number, number] }>,
  override?: number,
): number {
  if (Number.isFinite(override) && (override as number) > 1) return override as number;
  let maxAbs = 0;
  for (const b of bots) {
    const ax = Math.abs(b.pos[0]);
    const az = Math.abs(b.pos[2]);
    if (Number.isFinite(ax)) maxAbs = Math.max(maxAbs, ax);
    if (Number.isFinite(az)) maxAbs = Math.max(maxAbs, az);
  }
  // padding 15%; floor 6 so empty/near-origin fleets still read
  return Math.max(6, maxAbs * 1.15 || 6);
}

export function projectMinimap(
  bots: ReadonlyArray<MinimapBot>,
  lookAt: [number, number, number],
  span?: number,
): { points: MinimapPoint[]; home: { x: number; y: number }; span: number } {
  const s = spanFromPositions(bots, span);
  const hx = 0.5 + lookAt[0] / (2 * s);
  const hy = 0.5 + lookAt[2] / (2 * s);
  const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v));

  // Lane ring: bots in the same lane get a small angular offset so siblings do not stack.
  const laneCounts = new Map<string, number>();
  const laneIndex = new Map<string, number>();
  for (const b of bots) {
    const lane = b.lane || "default";
    laneIndex.set(b.id, laneCounts.get(lane) ?? 0);
    laneCounts.set(lane, (laneCounts.get(lane) ?? 0) + 1);
  }

  const raw: MinimapPoint[] = bots.map((b) => {
    const lane = b.lane || "default";
    const idx = laneIndex.get(b.id) ?? 0;
    const n = laneCounts.get(lane) ?? 1;
    const ang = hashUnit(`${lane}:${b.id}`) * Math.PI * 2 + (n > 1 ? (idx / n) * Math.PI * 2 : 0);
    // Base projection from real world XZ.
    let x = 0.5 + b.pos[0] / (2 * s);
    let y = 0.5 + b.pos[2] / (2 * s);
    // Deterministic micro-spread from lane/id (keeps honesty of relative layout).
    const jitter = 0.028 + 0.01 * hashUnit(b.id);
    x += Math.cos(ang) * jitter;
    y += Math.sin(ang) * jitter;
    return { id: b.id, x, y, health: b.health, lane: b.lane };
  });

  // One de-overlap pass: push apart pairs closer than MINIMAP_MIN_SEP using id order.
  const sorted = [...raw].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= MINIMAP_MIN_SEP) continue;
      if (d < 1e-9) {
        const ang = hashUnit(`${a.id}|${b.id}`) * Math.PI * 2;
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 1e-9;
      }
      const push = (MINIMAP_MIN_SEP - d) / 2;
      const ux = dx / d;
      const uy = dy / d;
      a.x -= ux * push;
      a.y -= uy * push;
      b.x += ux * push;
      b.y += uy * push;
    }
  }

  const points: MinimapPoint[] = raw.map((p) => ({
    ...p,
    x: clamp(p.x),
    y: clamp(p.y),
  }));
  return { points, home: { x: clamp(hx), y: clamp(hy) }, span: s };
}
