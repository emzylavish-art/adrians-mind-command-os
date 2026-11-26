/**
 * Resolve verified sessions consistently; disagreeing identities never pick a winner.
 * Used by verify.server so MCP list and other owner APIs accept Supabase cookies.
 */
export type SessionCandidate = { id: string; email: string | null; emailVerified?: boolean; displayName?: string | null; profileImageUrl?: string | null };

export class SessionConflictError extends Error {
  readonly status = 409;
  constructor() { super("Two different accounts are signed in. Sign out of this app, then sign in with the account you want to use."); this.name = "SessionConflictError"; }
}

export function pickSessionUser(input: {
  supabaseUser: SessionCandidate | null;
  betterAuthUser: SessionCandidate | null;
}): SessionCandidate | null {
  if (input.supabaseUser?.id && input.betterAuthUser?.id && input.supabaseUser.id !== input.betterAuthUser.id) return null;
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

export class SessionIdentityConflictError extends Error {
  readonly status = 409;
  constructor() {
    super("Your signed-in sessions identify different accounts. Sign out of the conflicting sessions and sign in to the intended account. No account was selected.");
    this.name = "SessionIdentityConflictError";
  }
}

export function verifiedSessionIdentity(input: {
  supabaseUser: SessionCandidate | null;
  betterAuthUser: SessionCandidate | null;
}): (SessionCandidate & { sessionSource: "supabase" | "better-auth" | "both" }) | null {
  if (input.supabaseUser?.id && input.betterAuthUser?.id && input.supabaseUser.id !== input.betterAuthUser.id) {
    throw new SessionIdentityConflictError();
  }
  const user = pickSessionUser(input);
  if (!user) return null;
  return { ...user, sessionSource: input.supabaseUser?.id ? (input.betterAuthUser?.id ? "both" : "supabase") : "better-auth" };
}

/** Only a definite missing session is signed out; an unavailable verifier is not. */
export function verifiedSupabaseCandidate(input: {
  user: { id?: string; email?: string | null } | null;
  error: { name?: string } | null;
}): SessionCandidate | null {
  if (input.error) {
    if (input.error.name === "AuthSessionMissingError") return null;
    throw new Error("Supabase account verification is unavailable. No account was selected.");
  }
  if (!input.user?.id) return null;
  return { id: input.user.id, email: input.user.email ?? null };
}
