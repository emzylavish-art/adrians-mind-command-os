/**
 * Server-only database URL resolution.
 * Prefer DATABASE_URL; fall back to Vercel/Supabase POSTGRES_URL.
 * Never log the returned value.
 */
export function resolveDatabaseUrl(env = process.env) {
  for (const key of ["DATABASE_URL", "POSTGRES_URL"]) {
    const value = typeof env[key] === "string" ? env[key].trim() : "";
    if (value) return value;
  }
  return undefined;
}

/** Migrations prefer a direct (non-pooler) connection when available. */
export function resolveMigrateDatabaseUrl(env = process.env) {
  for (const key of ["POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_URL"]) {
    const value = typeof env[key] === "string" ? env[key].trim() : "";
    if (value) return value;
  }
  return undefined;
}
