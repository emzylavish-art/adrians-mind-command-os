import type { ChartSeries, DashboardCharts } from "@/lib/mind/dashboard/chart-series";
import { NO_CHART_SOURCE } from "@/lib/mind/dashboard/chart-series";

function SparkBars({ series }: { series: ChartSeries }) {
  const max = Math.max(1, ...series.points.map((p) => p.value));
  const w = 220;
  const h = 72;
  const gap = 3;
  const n = Math.max(1, series.points.length);
  const barW = Math.max(4, (w - gap * (n + 1)) / n);
  if (!series.points.length) {
    return (
      <p className="dash3d-muted" style={{ fontSize: "0.68rem" }} data-testid="chart-empty">
        {series.emptyReason || NO_CHART_SOURCE}
      </p>
    );
  }
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
        const bh = Math.max(1, (p.value / max) * (h - 16));
        const x = gap + i * (barW + gap);
        const y = h - 12 - bh;
        return (
          <g key={`${p.label}-${i}`}>
            <rect x={x} y={y} width={barW} height={bh} rx={2} fill="rgba(125,211,252,0.75)" />
            <title>{`${p.label}: ${p.value} ${series.unit}`}</title>
          </g>
        );
      })}
      <line x1={0} y1={h - 12} x2={w} y2={h - 12} stroke="rgba(148,163,184,0.35)" />
    </svg>
  );
}

export function ChartsPanel({ charts }: { charts: DashboardCharts }) {
  const seriesList = [
    charts.commitsPerBotHour,
    charts.lockHealthShare,
    charts.landingsPerLane,
    charts.spend,
  ];
  return (
    <aside className="dash3d-charts-panel dash3d-glass" data-testid="charts-panel" aria-label="Real-data charts">
      <div className="dash3d-feed-head">
        <h2>Charts</h2>
        <p className="dash3d-muted" style={{ fontSize: "0.62rem" }}>
          git · locks · landings · spend
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
