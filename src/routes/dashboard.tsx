import { Suspense, lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

/** Perf: keep three.js / postfx / charts out of the route module graph until the shell paints. */
const DashboardApp = lazy(() =>
  import("@/components/mind/dashboard-3d/dashboard-app").then((m) => ({ default: m.DashboardApp })),
);

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · Universe" },
      { name: "theme-color", content: "#070b16" },
    ],
  }),
});

function DashboardShellFallback() {
  return (
    <main className="dash3d-root dash3d-universe" data-testid="dash3d-shell-fallback" aria-busy="true">
      <div className="dash3d-skybar" id="dash3d-skybar" role="status" aria-label="Loading dashboard">
        <div className="dash3d-glass dash3d-skybar-card">
          <h2>System weather</h2>
          <p className="dash3d-title">Painting the universe…</p>
          <p className="dash3d-muted" style={{ fontSize: "0.78rem" }}>
            Loading stage, charts, and status…
          </p>
        </div>
        <div className="dash3d-glass dash3d-skybar-card" aria-hidden="true">
          <h2>Status</h2>
          <p className="dash3d-muted" style={{ fontSize: "0.78rem" }}>
            Skeleton — live data streams in next.
          </p>
        </div>
      </div>
    </main>
  );
}

function DashboardPage() {
  return (
    <Suspense fallback={<DashboardShellFallback />}>
      <DashboardApp />
    </Suspense>
  );
}
