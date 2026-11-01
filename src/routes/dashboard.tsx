import { createFileRoute } from "@tanstack/react-router";
import { DashboardApp } from "@/components/mind/dashboard-3d/dashboard-app";
import { requireDashboardUser } from "@/lib/supabase/actions";

/**
 * Universe dashboard. A Better Auth or Supabase session may enter.
 * No session goes to sign-in.
 *
 * Auth is resolved only via createServerFn (requireDashboardUser). Do not
 * import `@/lib/auth/verify.server` here — TanStack Start import-protection
 * rejects *.server modules in the client graph (build fails since 206ed7d /
 * merge 714ad22).
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

function DashboardPage() {
  return <DashboardApp />;
}
