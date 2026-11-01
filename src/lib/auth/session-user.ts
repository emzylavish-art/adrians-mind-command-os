/**
 * Pure session pick: prefer a verified Supabase user, else Better Auth / gate.
 * Used by verify.server so MCP list and other owner APIs accept Supabase cookies.
 */
export type SessionCandidate = { id: string; email: string | null };

export function pickSessionUser(input: {
  supabaseUser: SessionCandidate | null;
  betterAuthUser: SessionCandidate | null;
}): SessionCandidate | null {
  if (input.supabaseUser?.id) {
    return {
      id: input.supabaseUser.id,
      email: input.supabaseUser.email ?? null,
    };
  }
  if (input.betterAuthUser?.id) {
    return {
      id: input.betterAuthUser.id,
      email: input.betterAuthUser.email ?? null,
    };
  }
  return null;
}
