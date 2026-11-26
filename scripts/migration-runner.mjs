// @ts-check
import { createHash } from "node:crypto";
import { pendingMigrations } from "./migration-plan.mjs";

/** @param {string} text */
export function migrationChecksum(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Run on an already acquired transaction. PostgreSQL's transaction-scoped lock
 * serializes independent deployment processes and is released on rollback too.
 * PGlite's transaction queue provides the corresponding local serialization.
 * @param {{query: (text: string, params?: unknown[]) => Promise<{rows: any[]}>, exec?: (text: string) => Promise<unknown>}} tx
 * @param {Record<string, string>} sources
 * @param {{postgres?: boolean, log?: (message: string) => void}} [options]
 */
export async function applyMigrationSet(tx, sources, options = {}) {
  if (options.postgres) {
    await tx.query("SET LOCAL lock_timeout = '30s'");
    await tx.query("SELECT pg_advisory_xact_lock(196087231, 1)");
  }
  await tx.query("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), checksum TEXT, checksum_origin TEXT)");
  await tx.query("ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum TEXT");
  await tx.query("ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum_origin TEXT");
  const rows = (await tx.query("SELECT name, checksum FROM _migrations")).rows;
  const files = pendingMigrations(Object.keys(sources), []);
  const byName = new Map(files.map(({ name, path }) => [name, { path, checksum: migrationChecksum(sources[path]) }]));
  // Check every known applied file before executing even the first new file.
  for (const row of rows) {
    const file = byName.get(row.name);
    if (file && row.checksum && row.checksum !== file.checksum) {
      throw new Error(`Applied migration ${row.name} changed. Restore its original contents and add a new migration.`);
    }
  }
  for (const row of rows) {
    const file = byName.get(row.name);
    if (file && !row.checksum) {
      await tx.query("UPDATE _migrations SET checksum = $2, checksum_origin = 'legacy-baseline' WHERE name = $1 AND checksum IS NULL", [row.name, file.checksum]);
      options.log?.(`[migrate] recorded legacy baseline for ${row.name}; original applied bytes were not independently verified.`);
    }
  }
  const pending = pendingMigrations(Object.keys(sources), rows.map((row) => row.name));
  for (const { name, path } of pending) {
    if (tx.exec) await tx.exec(sources[path]);
    else await tx.query(sources[path]);
    await tx.query("INSERT INTO _migrations (name, checksum, checksum_origin) VALUES ($1, $2, 'applied')", [name, migrationChecksum(sources[path])]);
  }
  return { applied: pending.map(({ name }) => name), verified: rows.filter((row) => row.checksum && byName.has(row.name)).map((row) => row.name), baselined: rows.filter((row) => !row.checksum && byName.has(row.name)).map((row) => row.name) };
}
