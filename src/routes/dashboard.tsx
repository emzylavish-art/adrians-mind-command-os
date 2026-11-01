import { createFileRoute } from "@tanstack/react-router";
import { DashboardApp } from "@/components/mind/dashboard-3d/dashboard-app";
import { requireSessionUser } from "@/lib/auth/require-session";

/**
 * Universe dashboard. A Better Auth or Supabase session may enter.
 * No session goes to sign-in.
 *
 * Session resolution stays inside createServerFn (dynamic import of verify.server)
 * so the client bundle never pulls server-only modules.
 */
export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const user = await requireSessionUser();
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

function DashboardPage() {
  return <DashboardApp />;
}
