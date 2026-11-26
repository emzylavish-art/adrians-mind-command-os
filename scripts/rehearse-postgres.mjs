// CI supplies an ephemeral PostgreSQL service on loopback. Never read an app DB URL.
import assert from "node:assert/strict";
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
const base = Object.fromEntries(Object.entries(sources).filter(([name]) => name.slice(0, 4) <= "0016"));

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
          await migrate(first, base);
          await first.query("INSERT INTO mind_snapshot (user_id,payload,updated_at) VALUES ($1,$2,now())", ["fixture", { message: "before" }]);
          await assert.rejects(migrate(first, { ...sources, "9999_fixture.sql": "SELECT missing_rehearsal_function()" }), { code: "42883" });
          assert.equal((await first.query("SELECT name FROM _migrations")).rowCount, Object.keys(base).length);
        }
        const runs = await Promise.all([migrate(first, sources), migrate(second, sources)]);
        const applied = runs.flatMap((result) => result.applied);
        const expected = files.filter((name) => mode === "clean" || !(name in base));
        assert.deepEqual(applied, expected);
        assert.equal((await migrate(first, sources)).applied.length, 0);
        if (mode === "upgrade") {
          assert.deepEqual((await second.query("SELECT payload FROM mind_snapshot WHERE user_id='fixture'")).rows[0].payload, { message: "before" });
          await second.query("UPDATE mind_snapshot SET payload=$1,updated_at=now() WHERE user_id='fixture'", [{ message: "after" }]);
          assert.deepEqual((await first.query("SELECT payload FROM mind_snapshot WHERE user_id='fixture'")).rows[0].payload, { message: "after" });
        }
        console.log(JSON.stringify({ mode, applied: applied.length, concurrentApplications: runs.map((r) => r.applied.length), rerun: 0 }));
      } finally { first.release(); second.release(); }
    } finally {
      await pool.end();
      await admin.query("DROP DATABASE " + database);
    }
  }
} finally { await admin.end(); }
