import { createFileRoute, redirect } from "@tanstack/react-router";
import { DashboardApp } from "@/components/mind/dashboard-3d/dashboard-app";
import { dashboardLoginSearch } from "@/lib/auth/login-providers";
import { getSessionUser } from "@/lib/auth/verify.server";

/**
 * Universe dashboard. A Better Auth or Supabase session may enter.
 * No session goes to sign-in.
 */
export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const user = await getSessionUser();
    if (!user) {
      throw redirect({
        to: "/login",
        search: dashboardLoginSearch(),
      });
    }
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
