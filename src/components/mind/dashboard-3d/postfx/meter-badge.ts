import type { ContrastReport } from "./detail-backdrop-dim.ts";
import type { SceneKeyLiftReport } from "./scene-key-lift.ts";
import type { CardEdgeReport } from "./card-edge.ts";
import type { ChartsDepthPlateReport } from "./charts-depth-plate.ts";

/**
 * #81→#83 debug badge: honest one-line state of the measured dim + meter
 * back-off (+ optional key lift). Only prints numbers that were really read;
 * absent values say so ("no reading", "no read yet"), never a placeholder.
 */
export type MeterBadge = {
  text: string;
  /** ok = measured & nominal; warn = backing off or static with an error; idle = static, no error. */
  level: "ok" | "warn" | "idle";
};

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "?");

export function formatMeterBadge(
  contrast:
    | (Pick<ContrastReport, "source" | "backdropLum" | "lastError" | "reads" | "backoff"> &
        Partial<Pick<ContrastReport, "card" | "cardProbe">>)
    | null
    | undefined,
  lift?: SceneKeyLiftReport | null,
  edge?: CardEdgeReport | null,
  plate?: ChartsDepthPlateReport | null,
): MeterBadge {
  if (!contrast) return { text: "dim: off", level: "idle" };
  const parts: string[] = [];
  parts.push(
    contrast.source === "measured" && contrast.backdropLum !== null
      ? `dim measured p90 ${fmt(contrast.backdropLum)}`
      : "dim static (no reading)",
  );
  // #84: card-vs-panel — the focused card's own rect, reported separately.
  if (contrast.card) parts.push(`card mean ${fmt(contrast.card.stats.mean)} p90 ${fmt(contrast.card.stats.p90)}`);
  else if (contrast.cardProbe) parts.push("card no reading");
  const b = contrast.backoff;
  parts.push(b && b.lastLatencyMs !== null ? `read ${Math.round(b.lastLatencyMs)}ms` : "no read yet");
  if (b && b.multiplier > 1) parts.push(`×${b.multiplier} ${b.reason ?? "backoff"} (${Math.round(b.intervalMs)}ms)`);
  if (contrast.lastError) parts.push(`err ${contrast.lastError}`);
  parts.push(`${contrast.reads} reads`);
  if (lift)
    parts.push(
      lift.source === "measured"
        ? `key +${fmt(lift.targetGain)}${lift.backdropSource ? ` (${lift.backdropSource})` : ""}`
        : "key off",
    );
  // #93: card-vs-surround edge separation — only the real measured ratio.
  if (edge)
    parts.push(
      edge.ratio === null
        ? "edge no reading"
        : edge.source === "measured"
          ? `edge ${fmt(edge.ratio)}:1 rim +${fmt(edge.targetGain)} (${edge.mode ?? "?"})`
          : `edge ${fmt(edge.ratio)}:1 ok`,
    );
  // #102: Charts depth plate — only the real measured spread under the rect.
  if (plate)
    parts.push(
      plate.spread === null
        ? "plate no reading"
        : plate.source === "measured"
          ? `plate spread ${fmt(plate.spread)} +${fmt(plate.targetStrength)}`
          : `plate spread ${fmt(plate.spread)} ok`,
    );
  const warn = (b && b.multiplier > 1) || !!contrast.lastError;
  const level = warn ? "warn" : contrast.source === "measured" ? "ok" : "idle";
  return { text: parts.join(" · "), level };
}
