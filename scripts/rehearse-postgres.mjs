// CI supplies an ephemeral PostgreSQL service on loopback. Never read an app DB URL.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { applyMigrationSet } from "./migration-runner.mjs";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw Error("Pass the TCP port of the disposable rehearsal cluster.");
}
const options = { host: "127.0.0.1", port, user: "rehearsal", password: "", database: "postgres", ssl: false };
const admin = new pg.Client(options);
const files = (await readdir("migrations")).filter((name) => name.endsWith(".sql")).sort();
const sources = Object.fromEntries(await Promise.all(files.map(async (name) => [name, await readFile("migrations/" + name, "utf8")])));
const prior = resolve(process.argv[3] || "previous-production");
const serviceContainer = process.argv[4];
assert(!serviceContainer || /^[a-f0-9]{64}$/.test(serviceContainer), "Expected the disposable PostgreSQL service container ID");
const baseline = "18d5b9364e6bdcfec028eeccf56fe596946ed8ce";
assert.equal(execFileSync("git", ["-C", prior, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline);
const previousFiles = (await readdir(join(prior, "migrations"))).filter(name => name.endsWith(".sql")).sort();
const base = {};
for (const name of previousFiles) {
  base[name] = await readFile(join(prior, "migrations", name), "utf8");
  assert.equal(sources[name], base[name], "Changed or removed deployed migration: " + name);
}
const oldStore = await import(pathToFileURL(join(prior, "src/lib/mind/store.ts")).href);
const { emptyWorkspace } = await import(pathToFileURL(join(prior, "src/lib/mind/workspace.ts")).href);
function oldAppSql(client) {
  const sql = async (parts, ...args) => {
    const query = parts.reduce((text, part, index) => text + (index ? "$" + index : "") + part, "");
    return (await client.query(query, args)).rows;
  };
  sql.query = async (query, args) => (await client.query(query, args)).rows;
  sql.transaction = async work => {
    await client.query("BEGIN");
    try {
      const result = await work(sql);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  };
  return sql;
}

async function migrate(client, set) {
  await client.query("BEGIN");
  try {
    const result = await applyMigrationSet(client, set, { postgres: true });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function rehearseRestore(database) {
  const backup = execFileSync("docker", ["exec", serviceContainer, "pg_dump", "-U", options.user, "--format=custom", database]);
  assert(backup.length > 0, "The prior schema and data must produce a backup");
  const restoredDatabase = database + "_restore";
  await admin.query("CREATE DATABASE " + restoredDatabase);
  const restored = new pg.Client({ ...options, database: restoredDatabase });
  try {
    execFileSync("docker", ["exec", "-i", serviceContainer, "pg_restore", "-U", options.user, "--exit-on-error", "--single-transaction", "-d", restoredDatabase], { input: backup });
    await restored.connect();
    const recorded = await restored.query("SELECT name FROM _migrations ORDER BY name");
    assert.deepEqual(recorded.rows.map(row => row.name), previousFiles);
    const snapshot = await oldStore.readSnapshot(oldAppSql(restored), "fixture");
    assert.equal(snapshot.projects.find(row => row.id === "before")?.name, "Prior application");
    assert.deepEqual((await migrate(restored, sources)).applied, files.filter(name => !(name in base)));
    assert.equal((await migrate(restored, sources)).applied.length, 0);
    console.log(JSON.stringify({ disposableBackupRestored: true, restoredLegacyMigrations: recorded.rowCount, restoredWorkspace: true, restoredDatabaseUpgrade: true }));
  } finally {
    await restored.end();
    await admin.query("DROP DATABASE " + restoredDatabase);
  }
}

await admin.connect();
try {
  for (const mode of ["clean", "upgrade"]) {
    const database = "mind_rehearsal_" + randomUUID().replaceAll("-", "");
    await admin.query("CREATE DATABASE " + database);
    const pool = new pg.Pool({ ...options, database, max: 2 });
    try {
      const first = await pool.connect();
      const second = await pool.connect();
      try {
        if (mode === "upgrade") {
          // Production's earlier migrator committed one file at a time and did not store checksums.
          await first.query("CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
          for (const [name, sql] of Object.entries(base)) {
            await first.query("BEGIN");
            await first.query(sql);
            await first.query("INSERT INTO _migrations(name) VALUES ($1)", [name]);
            await first.query("COMMIT");
          }
          const workspace = emptyWorkspace();
          workspace.projects.push({ id: "before", name: "Prior application", description: "", createdAt: new Date().toISOString() });
          assert.ok(await oldStore.writeSnapshot(oldAppSql(first), "fixture", workspace));
          if (serviceContainer) await rehearseRestore(database);
          await assert.rejects(migrate(first, { ...sources, "9999_fixture.sql": "SELECT missing_rehearsal_function()" }), { code: "42883" });
          assert.equal((await first.query("SELECT name FROM _migrations")).rowCount, Object.keys(base).length);
        }
        const runs = await Promise.all([migrate(first, sources), migrate(second, sources)]);
        const applied = runs.flatMap((result) => result.applied);
        const expected = files.filter((name) => mode === "clean" || !(name in base));
        assert.deepEqual(applied, expected);
        assert.equal((await migrate(first, sources)).applied.length, 0);
        if (mode === "upgrade") {
          const checksums = await first.query("SELECT name FROM _migrations WHERE checksum_origin='legacy-baseline' ORDER BY name");
          assert.deepEqual(checksums.rows.map(row => row.name), previousFiles);
          const oldSql = oldAppSql(second);
          const snapshot = await oldStore.readSnapshot(oldSql, "fixture");
          const project = snapshot.projects.find(row => row.id === "before");
          assert.equal(project?.name, "Prior application");
          await first.query("INSERT INTO mind_usage_ledger(user_id, operation_id, stage, payload) VALUES ('fixture','post-upgrade','answer','{}')");
          const revision = oldStore.snapshotRevision(snapshot);
          project.name = "Written after upgrade";
          assert.ok(await oldStore.writeSnapshot(oldSql, "fixture", snapshot, revision));
          assert.equal((await oldStore.readSnapshot(oldSql, "fixture")).projects.find(row => row.id === "before").name, project.name);
          assert.equal((await first.query("SELECT operation_id FROM mind_usage_ledger WHERE user_id='fixture'")).rows[0].operation_id, "post-upgrade");
          console.log(JSON.stringify({ oldApplication: baseline, legacyChecksums: checksums.rowCount, snapshotReadWrite: true, newUsagePreserved: true }));
        }
        console.log(JSON.stringify({ mode, applied: applied.length, concurrentApplications: runs.map((r) => r.applied.length), rerun: 0 }));
      } finally { first.release(); second.release(); }
    } finally {
      await pool.end();
      await admin.query("DROP DATABASE " + database);
    }
  }
} finally { await admin.end(); }
