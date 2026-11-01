/**
 * /dashboard gate via createServerFn so verify.server stays out of the client graph.
 * Auth on + no session → redirect /login. Auth off + no DB → shared dev user (local :8102).
 */
import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";

export const requireDashboardUser = createServerFn({ method: "GET" }).handler(async () => {
  const { getSessionUser, requireUserId } = await import("@/lib/auth/verify.server");
  try {
    const id = await requireUserId();
    const session = await getSessionUser();
    return { id: session?.id ?? id, email: session?.email ?? null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    const name = err instanceof Error ? err.name : "";
    if (name === "UnauthorizedError" || msg === "Unauthorized") {
      throw redirect({
        to: "/login",
        search: { next: "/dashboard" },
      });
    }
    throw err;
  }
});
