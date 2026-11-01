export function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/**
 * Workspace preview vs deployed app. The deployer writes GROK_PROJECT_ID on
 * every publish; the sandbox preview never has it. Single source of truth for
 * the split — gate audience, gate endpoints and connector-token semantics all
 * key off this predicate.
 */
export function isWorkspacePreview(): boolean {
  return !env("GROK_PROJECT_ID");
}

/**
 * Server-only Postgres URL for durable mind/auth storage.
 * Prefer `DATABASE_URL`; fall back to Vercel/Supabase `POSTGRES_URL`.
 * Never log the returned value. Never import from client code.
 */
export function resolveDatabaseUrl(
  processEnv: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const key of ["DATABASE_URL", "POSTGRES_URL"] as const) {
    const value = processEnv[key]?.trim();
    if (value) return value;
  }
  return undefined;
}
