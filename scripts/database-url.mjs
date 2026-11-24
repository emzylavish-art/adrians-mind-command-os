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

/** Project identity from a direct Supabase hostname or shared pooler username. */
export function supabaseDatabaseRef(value) {
  try {
    const url = new URL(value);
    const direct = /^db\.([a-z0-9]+)\.supabase\.(?:co|net)$/i.exec(url.hostname);
    if (direct) return direct[1].toLowerCase();
    if (!url.hostname.endsWith(".pooler.supabase.com")) return undefined;
    const pooled = /\.([a-z0-9]+)$/i.exec(decodeURIComponent(url.username));
    return pooled?.[1].toLowerCase();
  } catch {
    return undefined;
  }
}
