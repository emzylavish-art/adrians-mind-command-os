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
  for (const key of ["DATABASE_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_URL"]) {
    const value = typeof env[key] === "string" ? env[key].trim() : "";
    if (value) return value;
  }
  return undefined;
}

/**
 * Build node-postgres Pool/Client config for Supabase / managed Postgres.
 *
 * Newer `pg` treats `sslmode=require` in the URL as verify-full, which fails
 * Vercel→Supabase with SELF_SIGNED_CERT_IN_CHAIN. Strip sslmode from the URL and
 * pass ssl: { rejectUnauthorized: false } instead (Supabase uses a CA chain
 * Node does not trust by default on some deploy images).
 *
 * @param {string} databaseUrl
 * @returns {{ connectionString: string, ssl: { rejectUnauthorized: false }, max?: number }}
 */
export function buildMigratePoolConfig(databaseUrl, { max = 1 } = {}) {
  const connectionString = stripSslModeFromDatabaseUrl(databaseUrl);
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
    max,
  };
}

/**
 * Remove sslmode (and alias ssl) query params so pg does not override our ssl object.
 * @param {string} databaseUrl
 * @returns {string}
 */
export function stripSslModeFromDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || !databaseUrl.trim()) {
    return databaseUrl;
  }
  try {
    const url = new URL(databaseUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase() === "sslmode" || key.toLowerCase() === "ssl") {
        url.searchParams.delete(key);
      }
    }
    // URL serializes postgres:// correctly via href
    return url.toString();
  } catch {
    // Fallback for non-standard connection strings: strip sslmode=... pairs
    return databaseUrl
      .replace(/([?&])sslmode=[^&]*/gi, "$1")
      .replace(/([?&])ssl=[^&]*/gi, "$1")
      .replace(/\?&/, "?")
      .replace(/[?&]$/, "");
  }
}

/**
 * Whether migrate failures should fail the build (production only).
 * Preview/lane builds with a DATABASE_URL still attempt migrate after the TLS
 * fix, but must not exit 1 on residual connection errors.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function migrateFailuresAreFatal(env = process.env) {
  return env.VERCEL_ENV === "production";
}

