#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, `pg`).
 *
 * Runs explicitly after candidate verification (`npm run release:prepare`), applying pending files
 * in ../migrations to DATABASE_URL or POSTGRES_URL. The complete pass is serialized and applied in one transaction and
 * recorded in a `_migrations` table, so it runs once and is safe to re-run.
 *
 * The read is non-recursive, so the opt-in auth schema under migrations/auth/
 * is not applied to an app that never asked for sign-in.
 *
 * No DATABASE_URL/POSTGRES_URL (local / preview builds) -> skip; the PGLite fallback applies
 * the same files at startup instead (see src/lib/db.ts).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { pendingMigrations } from "./migration-plan.mjs";
import { applyMigrationSet } from "./migration-runner.mjs";
import { resolveDatabaseUrl, resolveMigrateDatabaseUrl, supabaseDatabaseRef } from "./database-url.mjs";
import { supabasePostgresPoolOptions } from "../src/lib/auth/postgres-ssl.mjs";
import { guardMindEnv } from "../src/lib/mind/isolation.ts";

// A Vercel Preview/Development build must never apply SQL against whichever
// DATABASE_URL was inherited from the project configuration. Only the
// production deployment is allowed to update the production schema.
// Local invocations remain explicit and continue to work.
if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
  console.log("[migrate] non-production Vercel environment — skipping database migrations.");
  process.exit(0);
}

const databaseUrl = resolveMigrateDatabaseUrl(process.env);
if (!databaseUrl) {
  console.log(
    "[migrate] DATABASE_URL/POSTGRES_URL not set — skipping (the PGLite fallback migrates itself).",
  );
  process.exit(0);
}

const runtimeUrl = resolveDatabaseUrl(process.env);
const mainDatabaseRef = runtimeUrl && supabaseDatabaseRef(runtimeUrl);
const migrationDatabaseRef = supabaseDatabaseRef(databaseUrl);
const declaredMindRef = process.env.MIND_SUPABASE_PROJECT_REF?.trim();
for (const url of [runtimeUrl, databaseUrl]) {
  const gate = guardMindEnv({
    databaseUrl: url,
    mindUrl: process.env.MIND_SUPABASE_URL,
    mindRef: declaredMindRef,
  });
  if (!gate.ok) {
    console.error("[migrate] refused a disallowed database configuration.");
    process.exit(1);
  }
}
if ((mainDatabaseRef && migrationDatabaseRef && mainDatabaseRef !== migrationDatabaseRef) ||
    (declaredMindRef && migrationDatabaseRef && declaredMindRef !== migrationDatabaseRef)) {
  console.error("[migrate] migration database does not match the configured Mind OS project.");
  process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch {
    console.log("[migrate] no migrations/ directory — nothing to do.");
    return;
  }
  // An app with no schema of its own must not pay for a database connection.
  if (pendingMigrations(entries, []).length === 0) {
    console.log("[migrate] no migrations — nothing to do.");
    return;
  }

  const pool = new pg.Pool({ ...supabasePostgresPoolOptions(databaseUrl), max: 1 });
  const client = await pool.connect();
  try {
    const sources = Object.fromEntries(await Promise.all(
      pendingMigrations(entries, []).map(async ({ name }) => [name, await readFile(join(migrationsDir, name), "utf8")]),
    ));
    await client.query("BEGIN");
    try {
      const result = await applyMigrationSet(client, sources, { postgres: true, log: console.log });
      await client.query("COMMIT");
      for (const name of result.applied) console.log(`[migrate] applied ${name}`);
      console.log(result.applied.length ? `[migrate] done — ${result.applied.length} migration(s) applied.` : "[migrate] up to date.");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve the original error */ }
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  // pg errors carry the context needed to debug a bad SQL file.
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
