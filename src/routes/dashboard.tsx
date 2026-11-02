import { Suspense, lazy, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { requireDashboardUser } from "@/lib/mind/dashboard/require-dashboard-user";

/** Perf: keep three.js / postfx / charts out of the route module graph until after hydrate. */
const DashboardApp = lazy(() =>
  import("@/components/mind/dashboard-3d/dashboard-app").then((m) => ({ default: m.DashboardApp })),
);

/**
 * Universe dashboard. Session via createServerFn (requireDashboardUser).
 * Do not import `@/lib/auth/verify.server` here — TanStack Start import-protection
 * rejects *.server modules in the client graph.
 */
export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const user = await requireDashboardUser();
    return { sessionUser: user };
  },
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

/**
 * Gap#65: do not render the lazy DashboardApp on the server or the first client
 * paint. SSR and hydrate both show the glass shell; the app mounts in useEffect
 * so a resolved server lazy chunk cannot disagree with the client tree.
 */
function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return <DashboardShellFallback />;
  return (
    <Suspense fallback={<DashboardShellFallback />}>
      <DashboardApp />
    </Suspense>
  );
}
