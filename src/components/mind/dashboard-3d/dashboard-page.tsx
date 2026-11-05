import { getRouteApi } from "@tanstack/react-router";
import { DashboardApp } from "@/components/mind/dashboard-3d/dashboard-app";
import type { DashboardAccess } from "@/lib/mind/dashboard/require-dashboard-user";

const dashboardRoute = getRouteApi("/dashboard");

export function DashboardPage() {
  const { access } = dashboardRoute.useRouteContext() as {
    access: DashboardAccess;
  };

  if (access.forbidden) {
    return (
      <main className="min-h-dvh bg-bg p-8 text-fg">
        <h1 className="text-2xl font-bold">Access denied</h1>
        <p className="mt-2 text-muted">
          You do not have permission to access this dashboard.
        </p>
      </main>
    );
  }

  return <DashboardApp />;
}
