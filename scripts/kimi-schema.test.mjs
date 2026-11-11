import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("Kimi migration applies locally and isolates owners", async () => {
  const db = new PGlite(mkdtempSync(join(tmpdir(), "kimi-schema-")));
  const sql = readFileSync(new URL("../migrations/0008_kimi_runtime.sql", import.meta.url), "utf8");
  await db.exec(sql);
  await db.query("insert into mind_kimi_session (user_id, id, status) values ($1, $2, $3)", ["owner-a", "session-1", "created"]);
  await db.query("insert into mind_kimi_session (user_id, id, status) values ($1, $2, $3)", ["owner-b", "session-1", "created"]);
  const own = await db.query("select user_id from mind_kimi_session where user_id = $1", ["owner-a"]);
  assert.equal(own.rows.length, 1);
  assert.equal(own.rows[0].user_id, "owner-a");
  const tables = await db.query("select tablename from pg_tables where tablename like 'mind_kimi_%' order by tablename");
  assert.deepEqual(tables.rows.map((row) => row.tablename), [
    "mind_kimi_approval",
    "mind_kimi_event",
    "mind_kimi_extension",
    "mind_kimi_runtime",
    "mind_kimi_session",
  ]);
  await db.close();
});
