import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assertReadOnlySql, pgliteQuery, type SqlLike } from "./tools.ts";

/**
 * Regression tests for the pglite_query side-effect bypass found in the
 * 2026-11-01 attacker pass. Each attack below used to pass assertReadOnlySql and
 * run against the real (shared, single-connection) PGLite database.
 */
describe("pglite_query guard: side-effect functions", () => {
  let db: PGlite;
  let client: SqlLike;
  let baselineSearchPath = "";

  before(async () => {
    db = new PGlite();
    await db.exec("create table t(id serial primary key, v text); insert into t(v) values ('a');");
    baselineSearchPath = (await db.query<{ search_path: string }>("show search_path")).rows[0].search_path;
    client = { query: async (q, p = []) => (await db.query(q, p)).rows as Record<string, unknown>[] };
  });
  after(async () => {
    await db.close();
  });

  const attacks = [
    "SELECT set_config('search_path', 'evil', false)",
    'SELECT "set_config"(\'search_path\', \'evil\', false)',
    "SELECT pg_catalog.set_config('search_path', 'evil', false)",
    "SELECT SET_CONFIG ('search_path','evil',false)",
    `SELECT U&"\\0073et_config"('search_path', 'evil', false)`,
    "SELECT nextval('t_id_seq')",
    "SELECT setval('t_id_seq', 999)",
    "SELECT pg_sleep(30)",
    "SELECT pg_sleep_for('30 seconds')",
    "SELECT pg_advisory_lock(42)",
    "SELECT pg_try_advisory_lock(42)",
    "SELECT lo_create(0)",
    "SELECT query_to_xml('select 1', true, true, '')",
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT pg_terminate_backend(1)",
    "SELECT * FROM t FOR SHARE",
    "SELECT * FROM t FOR KEY SHARE",
    "SELECT 1 INTO evil_copy",
    "EXPLAIN ANALYZE SELECT 1",
    "SELECT 1 /* /* nested */ set_config('search_path','x',false) */",
  ];

  for (const sql of attacks) {
    it(`refuses: ${sql}`, async () => {
      assert.equal(assertReadOnlySql(sql).ok, false);
      const result = await pgliteQuery({ sql, sqlClient: client });
      assert.equal(result.ok, false);
      assert.doesNotMatch(result.text, /rowCount/);
    });
  }

  it("leaves the shared session untouched after every attack", async () => {
    const [row] = (await db.query<{ search_path: string }>("show search_path")).rows;
    assert.equal(row.search_path, baselineSearchPath);
    assert.notEqual(row.search_path, "evil");
    const seq = (await db.query<{ last_value: number }>("select last_value from t_id_seq")).rows[0];
    assert.equal(Number(seq.last_value), 1);
    const locks = (await db.query<{ n: number }>("select count(*)::int as n from pg_locks where locktype = 'advisory'")).rows[0];
    assert.equal(locks.n, 0);
    const tables = (await db.query<{ n: number }>("select count(*)::int as n from pg_tables where tablename = 'evil_copy'")).rows[0];
    assert.equal(tables.n, 0);
  });

  it("refuses a pg_sleep call quickly instead of freezing the event loop", async () => {
    const started = Date.now();
    const result = await pgliteQuery({ sql: "SELECT pg_sleep(5)", sqlClient: client, timeoutMs: 100 });
    assert.equal(result.ok, false);
    assert.ok(Date.now() - started < 1000);
  });

  it("still runs ordinary reads, CTEs, and plain EXPLAIN", async () => {
    const read = await pgliteQuery({ sql: "SELECT id, v FROM t ORDER BY id", sqlClient: client });
    assert.equal(read.ok, true);
    assert.match(read.text, /"v": "a"/);
    const cte = await pgliteQuery({ sql: "WITH x AS (SELECT count(*)::int AS n FROM t) SELECT n FROM x", sqlClient: client });
    assert.equal(cte.ok, true);
    const plan = await pgliteQuery({ sql: "EXPLAIN SELECT * FROM t", sqlClient: client });
    assert.equal(plan.ok, true, plan.text);
    assert.match(plan.text, /QUERY PLAN/);
    const schema = await pgliteQuery({ sql: "SELECT current_setting('search_path') AS sp", sqlClient: client });
    assert.equal(schema.ok, true);
  });

  it("refuses oversized SQL", () => {
    assert.equal(assertReadOnlySql("SELECT " + "1,".repeat(15_000) + "1").ok, false);
  });
});
