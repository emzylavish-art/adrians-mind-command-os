import type { ChartSeries, DashboardCharts } from "@/lib/mind/dashboard/chart-series";
import { NO_CHART_SOURCE } from "@/lib/mind/dashboard/chart-series";
import { chartTickLabel } from "@/lib/mind/dashboard/chart-tick-label";

/** Gap#62 — coerce hostile chart numbers; never feed NaN into SVG. */
function finiteChartValue(n: unknown): number | null {
  if (typeof n === "string" && n.trim() !== "") {
    const parsed = Number(n);
    n = parsed;
  }
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < 0) return null;
  if (n > 1e12) return 1e12;
  return n;
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (abs >= 100) return String(Math.round(n));
  if (abs >= 10) return n.toFixed(1);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

/** Gap#63 — keep only the last N points that fit the viewBox; drop invisible Tab stops. */
export const CHART_VISIBLE_MAX = 28;

function SparkBars({
  series,
  onActivate,
}: {
  series: ChartSeries;
  onActivate?: (point: { label: string; value: number; index: number }) => void;
}) {
  const cleaned = series.points
    .map((p, index) => {
      const value = finiteChartValue(p.value);
      const alt = p.altValue == null ? null : finiteChartValue(p.altValue);
      if (value == null) return null;
      return { label: String(p.label ?? "").slice(0, 48) || `p${index}`, value, altValue: alt ?? undefined, index };
    })
    .filter(Boolean) as Array<{ label: string; value: number; altValue?: number; index: number }>;

  // Prefer newest points when dense (commits/day grows forever).
  const visible =
    cleaned.length > CHART_VISIBLE_MAX ? cleaned.slice(cleaned.length - CHART_VISIBLE_MAX) : cleaned;

  const max = Math.max(1, ...visible.map((p) => Math.max(p.value, p.altValue ?? 0)));
  const w = 220;
  const h = 84;
  const gap = 3;
  const n = Math.max(1, visible.length);
  const dense = n >= 7;
  const paired = visible.some((p) => p.altValue != null);
  const barW = Math.max(4, (w - gap * (n + 1)) / n);

  if (!visible.length) {
    return (
      <div className="dash3d-chart-empty" data-testid="chart-empty">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${series.title}: empty`}>
          <rect x={1} y={1} width={w - 2} height={h - 14} rx={6} fill="rgba(148,163,184,0.06)" stroke="rgba(148,163,184,0.22)" />
          <line x1={12} y1={h - 22} x2={w - 12} y2={h - 22} stroke="rgba(148,163,184,0.25)" strokeDasharray="4 4" />
        </svg>
        <p className="dash3d-muted" style={{ fontSize: "0.68rem", margin: 0 }}>
          {series.emptyReason || NO_CHART_SOURCE}
        </p>
      </div>
    );
  }

  const topIdx = visible.reduce((bi, p, i, arr) => (p.value > arr[bi]!.value ? i : bi), 0);

  return (
    <div className="dash3d-spark" data-testid={`chart-spark-${series.id}`} style={{ position: "relative" }}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={series.title}
        data-testid={`chart-${series.id}`}
      >
        {visible.map((p, i) => {
          const bh = Math.max(p.value > 0 ? 4 : 0, (p.value / max) * (h - 28));
          const x = gap + i * (barW + gap);
          const y = h - 14 - bh;
          const tick = chartTickLabel(p.label, dense);
          const showValue = !dense || i === topIdx || n <= 6;
          const aria =
            p.altValue != null
              ? `${p.label}: ${formatCompact(p.value)} claims, ${formatCompact(p.altValue)} releases`
              : `${p.label}: ${formatCompact(p.value)} ${series.unit}`;
          const half = paired ? Math.max(2, (barW - 1) / 2) : barW;
          const altH = p.altValue != null ? Math.max(p.altValue > 0 ? 4 : 0, (p.altValue / max) * (h - 28)) : 0;
          const altY = h - 14 - altH;
          return (
            <g
              key={`${p.label}-${p.index}`}
              tabIndex={0}
              role="listitem"
              aria-label={aria}
              data-testid={`chart-mark-${series.id}-${i}`}
              data-tip={aria}
              style={{ cursor: onActivate ? "pointer" : undefined }}
              onClick={() => onActivate?.({ label: p.label, value: p.value, index: p.index })}
              onFocus={(ev) => {
                const host = (ev.currentTarget.closest(".dash3d-spark") as HTMLElement | null);
                const tip = host?.querySelector("[data-testid=chart-focus-tip]") as HTMLElement | null;
                if (tip) {
                  tip.textContent = aria;
                  tip.hidden = false;
                  tip.style.left = `${Math.min(w - 120, Math.max(0, x))}px`;
                }
              }}
              onBlur={(ev) => {
                const host = (ev.currentTarget.closest(".dash3d-spark") as HTMLElement | null);
                const tip = host?.querySelector("[data-testid=chart-focus-tip]") as HTMLElement | null;
                if (tip && !host?.contains(ev.relatedTarget as Node)) tip.hidden = true;
              }}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  onActivate?.({ label: p.label, value: p.value, index: p.index });
                }
              }}
            >
              <rect x={x} y={Number.isFinite(y) ? y : h - 14} width={half} height={Number.isFinite(bh) ? bh || 0.01 : 0.01} rx={2} fill="rgba(125,211,252,0.75)" />
              {p.altValue != null ? (
                <rect
                  x={x + half + 1}
                  y={Number.isFinite(altY) ? altY : h - 14}
                  width={half}
                  height={Number.isFinite(altH) ? altH || 0.01 : 0.01}
                  rx={2}
                  fill="rgba(251,191,36,0.7)"
                />
              ) : null}
              {showValue ? (
                <text
                  x={x + barW / 2}
                  y={Math.max(10, Math.min(Number.isFinite(y) ? y : h - 14, Number.isFinite(altY) ? altY : h - 14) - 3)}
                  textAnchor="middle"
                  fill="rgba(226,232,240,0.95)"
                  fontSize="8"
                >
                  {p.altValue != null ? `${formatCompact(p.value)}/${formatCompact(p.altValue)}` : formatCompact(p.value)}
                </text>
              ) : null}
              <text x={x + barW / 2} y={h - 2} textAnchor="middle" fill="rgba(226,232,240,0.85)" fontSize="8">
                {tick}
              </text>
            </g>
          );
        })}
        <line x1={0} y1={h - 14} x2={w} y2={h - 14} stroke="rgba(148,163,184,0.35)" />
      </svg>
      {/* Gap#64 — one shared visible tip on keyboard focus / tap (not 1×1 foreignObject). */}
      <div
        data-testid="chart-focus-tip"
        role="tooltip"
        hidden
        className="dash3d-chart-tip"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 2,
          maxWidth: "12rem",
          padding: "0.2rem 0.45rem",
          borderRadius: 6,
          fontSize: "0.68rem",
          background: "rgba(8,12,24,0.92)",
          color: "#e8eefc",
          pointerEvents: "none",
          border: "1px solid rgba(148,163,184,0.35)",
        }}
      />
      {cleaned.length > visible.length ? (
        <p className="dash3d-muted" style={{ fontSize: "0.62rem", margin: "0.15rem 0 0" }} data-testid="chart-window-note">
          Showing last {visible.length} of {cleaned.length}
        </p>
      ) : null}
    </div>
  );
}

export function ChartsPanel({
  charts,
  scrubNote,
  onSelectBotId,
  onScrubRatio,
}: {
  charts: DashboardCharts;
  /** Gap#48 — when scrubbing, honest note if series follow scrub or stay Live. */
  scrubNote?: string | null;
  /** c49 visual: drill bot-health / commits-per-bot marks into that star. */
  onSelectBotId?: (botId: string) => void;
  /** c49 visual: drill lock-hour marks toward that scrub ratio 0..1. */
  onScrubRatio?: (ratio: number) => void;
}) {
  const seriesList = [
    charts.botHealth,
    charts.commitsPerBotHour,
    charts.commitsPerDay,
    charts.lockHealthShare,
    charts.landingsPerLane,
    charts.spend,
  ].filter(Boolean);
  const showLaneLegend = seriesList.some((s) => s.id === "commits-per-bot" || s.id.includes("bot"));
  return (
    <aside className="dash3d-charts-panel dash3d-glass" data-testid="charts-panel" aria-label="Real-data charts">
      <div className="dash3d-feed-head">
        <h2>Charts</h2>
        <p className="dash3d-muted" style={{ fontSize: "0.62rem" }}>
          health · commits · activity · spend
        </p>
      </div>
      {scrubNote ? (
        <p className="dash3d-muted" data-testid="charts-scrub-note" style={{ fontSize: "0.65rem", margin: "0 0 0.35rem" }}>
          {scrubNote}
        </p>
      ) : null}
      {showLaneLegend ? (
        <p className="dash3d-muted" data-testid="charts-lane-legend" style={{ fontSize: "0.58rem", margin: "0 0 0.35rem" }}>
          Lane initials on bot bars (cp=cosmos-painter, cl=cosmos-light, cm=cosmos-motion, …). Lock chart: cyan=claims,
          amber=releases.
        </p>
      ) : null}
      <div className="dash3d-charts-grid">
        {seriesList.map((s) => (
          <section key={s.id} className="dash3d-chart-card">
            <h3>{s.title}</h3>
            <SparkBars
              series={s}
              onActivate={
                onSelectBotId || onScrubRatio
                  ? (pt) => {
                      // Bot health / commits-per-bot: label is a bot id or initials-expanded id.
                      if (s.id === "bot-health" || s.id === "commits-per-bot" || s.id.includes("commits-per-bot")) {
                        const id = pt.label.split(/\s|·/)[0]!.toLowerCase();
                        if (id && onSelectBotId) onSelectBotId(id);
                        return;
                      }
                      if (s.id === "lock-health-share" && onScrubRatio) {
                        const n = Math.max(1, s.points.length);
                        onScrubRatio(pt.index / Math.max(1, n - 1));
                      }
                    }
                  : undefined
              }
            />
            <p className="dash3d-mono dash3d-muted" style={{ fontSize: "0.58rem" }}>
              {s.source}
            </p>
          </section>
        ))}
      </div>
    </aside>
  );
}
