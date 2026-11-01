/**
 * Queue #30 / Gap#8 — project world XZ into a 0..1 minimap square (universe framing).
 */
export type MinimapPoint = { id: string; x: number; y: number; health?: string };

export function projectMinimap(
  bots: ReadonlyArray<{ id: string; pos: [number, number, number]; health?: string }>,
  lookAt: [number, number, number],
  span = 16,
): { points: MinimapPoint[]; home: { x: number; y: number } } {
  const s = Number.isFinite(span) && span > 1 ? span : 16;
  const hx = 0.5 + lookAt[0] / (2 * s);
  const hy = 0.5 + lookAt[2] / (2 * s);
  const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v));
  const points: MinimapPoint[] = bots.map((b) => ({
    id: b.id,
    x: clamp(0.5 + b.pos[0] / (2 * s)),
    y: clamp(0.5 + b.pos[2] / (2 * s)),
    health: b.health,
  }));
  return { points, home: { x: clamp(hx), y: clamp(hy) } };
}
