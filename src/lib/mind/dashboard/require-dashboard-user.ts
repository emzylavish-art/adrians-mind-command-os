/**
 * /dashboard session gate. createServerFn keeps verify.server out of the client graph.
 * No session redirects to sign-in. This does not grant the shared dev user.
 */
import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { dashboardLoginSearch } from "@/lib/auth/login-providers";
import { isMindOwnerId } from "@/lib/mind/dashboard/owner.server";

export type DashboardAccess =
  | { forbidden: true }
  | { forbidden: false; sessionUser: { id: string; email: string | null } };

export const requireDashboardUser = createServerFn({ method: "GET" }).handler(async (): Promise<DashboardAccess> => {
  const { getSessionUser } = await import("@/lib/auth/verify.server");
  const user = await getSessionUser();
  if (!user) {
    throw redirect({
      to: "/login",
      search: dashboardLoginSearch(),
    });
  }
  if (!isMindOwnerId(user.id)) {
    return { forbidden: true };
  }
  return { forbidden: false, sessionUser: { id: user.id, email: user.email } };
});
