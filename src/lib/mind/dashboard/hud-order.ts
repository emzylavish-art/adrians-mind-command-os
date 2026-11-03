/** Order HUD cards: needs-you and blocked first, then status, then charts. */
export type HudBand = "needs" | "status" | "charts";

export type HudOrderItem = {
  id: string;
  band: HudBand;
  seq: number;
};

const BAND_RANK: Record<HudBand, number> = { needs: 0, status: 1, charts: 2 };

export function sortHudCards<T extends HudOrderItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => BAND_RANK[a.band] - BAND_RANK[b.band] || a.seq - b.seq);
}

export function hudDefaultOpen(index: number): boolean {
  return index < 2;
}
