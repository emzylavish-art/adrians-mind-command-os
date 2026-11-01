import type { ChartSeries, DashboardCharts } from "@/lib/mind/dashboard/chart-series";
import { NO_CHART_SOURCE } from "@/lib/mind/dashboard/chart-series";
import { chartTickLabel } from "@/lib/mind/dashboard/chart-tick-label";

function SparkBars({ series }: { series: ChartSeries }) {
  const max = Math.max(1, ...series.points.map((p) => p.value));
  const w = 220;
  const h = 84;
  const gap = 3;
  const n = Math.max(1, series.points.length);
  const dense = n >= 7;
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
        const bh = Math.max(4, (p.value / max) * (h - 28));
        const x = gap + i * (barW + gap);
        const y = h - 14 - bh;
        const tick = chartTickLabel(p.label, dense);
        const showValue = !dense || i === topIdx || n <= 6;
        const aria = `${p.label}: ${p.value} ${series.unit}`;
        return (
          <g
            key={`${p.label}-${i}`}
            tabIndex={0}
            role="listitem"
            aria-label={aria}
            data-testid={`chart-mark-${series.id}-${i}`}
          >
            <rect x={x} y={y} width={barW} height={bh} rx={2} fill="rgba(125,211,252,0.75)" />
            {showValue ? (
              <text
                x={x + barW / 2}
                y={Math.max(10, y - 3)}
                textAnchor="middle"
                fill="rgba(226,232,240,0.95)"
                fontSize="8"
              >
                {p.value}
              </text>
            ) : null}
            <text x={x + barW / 2} y={h - 2} textAnchor="middle" fill="rgba(226,232,240,0.85)" fontSize="8">
              {tick}
            </text>
            <title>{aria}</title>
          </g>
        );
      })}
      <line x1={0} y1={h - 14} x2={w} y2={h - 14} stroke="rgba(148,163,184,0.35)" />
    </svg>
  );
}

export function ChartsPanel({ charts }: { charts: DashboardCharts }) {
  const seriesList = [
    charts.botHealth,
    charts.commitsPerBotHour,
    charts.commitsPerDay,
    charts.lockHealthShare,
    charts.landingsPerLane,
    charts.spend,
  ].filter(Boolean);
  return (
    <aside className="dash3d-charts-panel dash3d-glass" data-testid="charts-panel" aria-label="Real-data charts">
      <div className="dash3d-feed-head">
        <h2>Charts</h2>
        <p className="dash3d-muted" style={{ fontSize: "0.62rem" }}>
          health · commits · activity · spend
        </p>
      </div>
      <div className="dash3d-charts-grid">
        {seriesList.map((s) => (
          <section key={s.id} className="dash3d-chart-card">
            <h3>{s.title}</h3>
            <SparkBars series={s} />
            <p className="dash3d-mono dash3d-muted" style={{ fontSize: "0.58rem" }}>
              {s.source}
            </p>
          </section>
        ))}
      </div>
    </aside>
  );
}
