/** Gap#26: filter constellation edge records by N-hop / graph visible id sets. */
export type EdgeVisibilityRec = { from: string; to: string };

export function filterEdgeRecsByVisibility<T extends EdgeVisibilityRec>(
  recs: readonly T[],
  nhopVisibleIds: Set<string> | null | undefined,
  graphVisibleIds: Set<string> | null | undefined,
): T[] {
  if (nhopVisibleIds) {
    return recs.filter((e) => nhopVisibleIds.has(e.from) && nhopVisibleIds.has(e.to));
  }
  if (graphVisibleIds) {
    return recs.filter((e) => graphVisibleIds.has(e.from) && graphVisibleIds.has(e.to));
  }
  return recs.slice();
}
