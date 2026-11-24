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

/** Grant the anonymous workstation identity only in a local runtime without a shared DB. */
export function localPreviewIdentityAllowed(host: string, env: NodeJS.ProcessEnv): boolean {
  if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL || env.GROK_PROJECT_ID ||
      env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim()) return false;
  if (env.ADRIAN_PC !== "1" && env.NODE_ENV !== "development" && env.NODE_ENV !== "test") return false;
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(host);
}
