import type { ChartSeries, DashboardCharts } from "@/lib/mind/dashboard/chart-series";
import { NO_CHART_SOURCE } from "@/lib/mind/dashboard/chart-series";
import { chartTickLabel } from "@/lib/mind/dashboard/chart-tick-label";

function SparkBars({
  series,
  onActivate,
}: {
  series: ChartSeries;
  onActivate?: (point: { label: string; value: number; index: number }) => void;
}) {
  const max = Math.max(
    1,
    ...series.points.map((p) => Math.max(p.value, p.altValue ?? 0)),
  );
  const w = 220;
  const h = 84;
  const gap = 3;
  const n = Math.max(1, series.points.length);
  const dense = n >= 7;
  const paired = series.points.some((p) => p.altValue != null);
  const barW = Math.max(4, (w - gap * (n + 1)) / n);
  if (!series.points.length) {
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
  const topIdx = series.points.reduce((bi, p, i, arr) => (p.value > arr[bi]!.value ? i : bi), 0);
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={series.title}
      data-testid={`chart-${series.id}`}
    >
      {series.points.map((p, i) => {
        const bh = Math.max(p.value > 0 ? 4 : 0, (p.value / max) * (h - 28));
        const x = gap + i * (barW + gap);
        const y = h - 14 - bh;
        const tick = chartTickLabel(p.label, dense);
        const showValue = !dense || i === topIdx || n <= 6;
        const aria =
          p.altValue != null
            ? `${p.label}: ${p.value} claims, ${p.altValue} releases`
            : `${p.label}: ${p.value} ${series.unit}`;
        const half = paired ? Math.max(2, (barW - 1) / 2) : barW;
        const altH = p.altValue != null ? Math.max(p.altValue > 0 ? 4 : 0, (p.altValue / max) * (h - 28)) : 0;
        const altY = h - 14 - altH;
        return (
          <g
            key={`${p.label}-${i}`}
            tabIndex={0}
            role="listitem"
            aria-label={aria}
            data-testid={`chart-mark-${series.id}-${i}`}
            style={{ cursor: onActivate ? "pointer" : undefined }}
            onClick={() => onActivate?.({ label: p.label, value: p.value, index: i })}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onActivate?.({ label: p.label, value: p.value, index: i });
              }
            }}
          >
            <rect x={x} y={y} width={half} height={bh || 0.01} rx={2} fill="rgba(125,211,252,0.75)" />
            {p.altValue != null ? (
              <rect
                x={x + half + 1}
                y={altY}
                width={half}
                height={altH || 0.01}
                rx={2}
                fill="rgba(251,191,36,0.7)"
              />
            ) : null}
            {showValue ? (
              <text
                x={x + barW / 2}
                y={Math.max(10, Math.min(y, altY) - 3)}
                textAnchor="middle"
                fill="rgba(226,232,240,0.95)"
                fontSize="8"
              >
                {p.altValue != null ? `${p.value}/${p.altValue}` : p.value}
              </text>
            ) : null}
            <text x={x + barW / 2} y={h - 2} textAnchor="middle" fill="rgba(226,232,240,0.85)" fontSize="8">
              {tick}
            </text>
            {/* Gap#49: real tooltip text for keyboard/touch focus (not empty). */}
            <title>{aria}</title>
            <foreignObject x={x} y={0} width={barW} height={1} style={{ overflow: "visible" }}>
              <span role="tooltip" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
                {aria}
              </span>
            </foreignObject>
          </g>
        );
      })}
      <line x1={0} y1={h - 14} x2={w} y2={h - 14} stroke="rgba(148,163,184,0.35)" />
    </svg>
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
