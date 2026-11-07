/** Screen-space label culling. Pure geometry; the scene only writes opacity. */
export type LabelRect = {
  id: string;
  priority: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function cullLabelIds(
  labels: readonly LabelRect[],
  opts: { zoomedOut: boolean; viewportHeight: number; bottomFraction?: number },
): string[] {
  const bottomFraction = opts.bottomFraction ?? 0.22;
  const cutoff = opts.viewportHeight * (1 - bottomFraction);
  const ranked = [...labels].sort((a, b) => a.priority - b.priority || a.top - b.top);
  const kept: LabelRect[] = [];
  const hide: string[] = [];
  for (const label of ranked) {
    const bottomRow = opts.zoomedOut && label.top >= cutoff;
    const hits = kept.some(
      (other) =>
        label.left < other.right &&
        label.right > other.left &&
        label.top < other.bottom &&
        label.bottom > other.top,
    );
    if (bottomRow || hits) hide.push(label.id);
    else kept.push(label);
  }
  return hide;
}
