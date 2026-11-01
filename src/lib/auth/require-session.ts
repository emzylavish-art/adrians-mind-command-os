/**
 * Client-safe session gate for route beforeLoad.
 * Dynamically imports verify.server inside the server fn (import-protection safe).
 */
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { dashboardLoginSearch } from "./login-providers";

export const requireSessionUser = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getSessionUser } = await import("./verify.server");
    const user = await getSessionUser();
    if (!user) {
      throw redirect({
        to: "/login",
        search: dashboardLoginSearch(),
      });
    }
    return user;
  },
);
