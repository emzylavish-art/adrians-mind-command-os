/**
 * Queue #28 / Gap#6 — local N-hop neighborhood around a focused star.
 */
import type { ConstellationEdge } from "./constellations.ts";

export function buildAdjacency(edges: readonly ConstellationEdge[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!m.has(a)) m.set(a, new Set());
    if (!m.has(b)) m.set(b, new Set());
    m.get(a)!.add(b);
    m.get(b)!.add(a);
  };
  for (const e of edges) add(String(e.from), String(e.to));
  return m;
}

/** Bots within `depth` hops of `root` (inclusive). depth<=0 → {root} only. */
export function nhopBotIds(
  root: string,
  edges: readonly ConstellationEdge[],
  depth: number,
): Set<string> {
  const id = String(root || "");
  const out = new Set<string>();
  if (!id) return out;
  out.add(id);
  const d = Number.isFinite(depth) ? Math.max(0, Math.min(8, Math.floor(depth))) : 0;
  if (d === 0) return out;
  const adj = buildAdjacency(edges);
  let frontier = [id];
  for (let hop = 0; hop < d; hop++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of adj.get(cur) ?? []) {
        if (out.has(n)) continue;
        out.add(n);
        next.push(n);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return out;
}
