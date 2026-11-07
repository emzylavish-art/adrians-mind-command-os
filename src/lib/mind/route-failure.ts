import type { RouteState } from "./logic-routes.ts";

export type RouteFailureAction = "setup" | "retry" | "none";

/**
 * Needs-config, blocked, a missing database, or a missing budget var is Setup.
 * Setup names the var in the message and does not offer Retry.
 */
export function routeFailureAction(input: {
  state?: RouteState | "missing-db" | null;
  error?: string | null;
}): RouteFailureAction {
  const error = input.error ?? "";
  if (input.state === "needs-config" || input.state === "blocked" || input.state === "missing-db") return "setup";
  if (/needs config|no adapter wired|not wired|MIND_COMMAND_BUDGET_|DATABASE_URL|POSTGRES_URL|budget cap|budget values/i.test(error)) {
    return "setup";
  }
  if (!input.state && !error.trim()) return "none";
  if (input.state === "configured" || input.state === "authenticated") return "retry";
  return "retry";
}
