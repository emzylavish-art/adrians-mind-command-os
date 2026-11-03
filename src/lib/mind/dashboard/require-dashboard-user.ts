/**
 * /dashboard session gate. createServerFn keeps verify.server out of the client graph.
 * No session redirects to sign-in. This does not grant the shared dev user.
 */
import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { dashboardLoginSearch } from "@/lib/auth/login-providers";

export const requireDashboardUser = createServerFn({ method: "GET" }).handler(async () => {
  const { getSessionUser } = await import("@/lib/auth/verify.server");
  const user = await getSessionUser();
  if (!user) {
    throw redirect({
      to: "/login",
      search: dashboardLoginSearch(),
    });
  }
  return { sessionUser: { id: user.id, email: user.email } };
});
