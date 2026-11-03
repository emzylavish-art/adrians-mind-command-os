/**
 * Pure gate decision for /dashboard (and similar protected routes).
 * Fail closed when env is missing — anonymous users never receive the page.
 */

export type SupabaseGateUser = {
  id: string;
  email: string | null;
};

export type GateDecision =
  | { action: "allow"; user: SupabaseGateUser }
  | { action: "redirect_login"; reason: "missing_env" | "no_user" };

export function decideDashboardGate(input: {
  configured: boolean;
  user: SupabaseGateUser | null;
}): GateDecision {
  if (!input.configured) {
    return { action: "redirect_login", reason: "missing_env" };
  }
  if (!input.user?.id) {
    return { action: "redirect_login", reason: "no_user" };
  }
  return {
    action: "allow",
    user: { id: input.user.id, email: input.user.email ?? null },
  };
}
