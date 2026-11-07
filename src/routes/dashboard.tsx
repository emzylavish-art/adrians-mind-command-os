import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/mind/dashboard-3d/dashboard-page";
import { requireDashboardUser } from "@/lib/mind/dashboard/require-dashboard-user";

/**
 * Universe dashboard. A Better Auth or Supabase session may enter.
 * No session goes to sign-in. The check runs in a server function.
 */
export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => ({ access: await requireDashboardUser() }),
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · Universe" },
      { name: "theme-color", content: "#070b16" },
    ],
  }),
});
