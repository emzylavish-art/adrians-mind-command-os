import { createFileRoute } from "@tanstack/react-router";
import { CommandApp } from "@/components/mind/command-app";
import { requireDashboardUser } from "@/lib/supabase/actions";

/**
 * Owner command surface, gated by Supabase Auth.
 * beforeLoad runs on the server during SSR so anonymous visitors never
 * receive the dashboard document. Missing Supabase env fails closed → /login.
 */
export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const user = await requireDashboardUser();
    return { supabaseUser: user };
  },
  component: Dashboard,
});

function Dashboard() {
  return <CommandApp />;
}
