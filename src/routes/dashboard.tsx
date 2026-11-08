import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/mind/dashboard-3d/dashboard-page";

/**
 * Public read-only dashboard. The dashboard status endpoint intentionally
 * exposes the same read-only operational snapshot without requiring a login.
 * Mutating APIs and operator actions retain their own authentication checks.
 */
export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · 3D Graph Dashboard" },
      { name: "theme-color", content: "#05070d" },
    ],
  }),
});
