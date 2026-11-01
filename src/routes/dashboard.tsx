import { createFileRoute } from "@tanstack/react-router";
import { DashboardApp } from "@/components/mind/dashboard-3d/dashboard-app";
import { requireDashboardUser } from "@/lib/supabase/actions";

/**
 * Universe dashboard, gated by owner session (Supabase or Better Auth via
 * requireDashboardUser → getUser / shared session). Anonymous visitors never
 * receive the dashboard document. Missing Supabase env still fails closed to
 * /login so the polished sign-in surface is reachable.
 */
export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const user = await requireDashboardUser();
    return { supabaseUser: user };
  },
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · Universe" },
      { name: "theme-color", content: "#070b16" },
    ],
  }),
});

function DashboardPage() {
  return <DashboardApp />;
}
