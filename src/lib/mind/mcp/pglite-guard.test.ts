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
    client = {
      query: async (q, p = []) => (await db.query(q, p)).rows as Record<string, unknown>[],
      exec: async (q) => {
        await db.exec(q);
      },
    };
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

  it("treats nested block comments as comments (payload inside does not execute)", async () => {
    const sql = "SELECT 1 /* /* nested */ set_config('search_path','x',false) */ AS n";
    assert.equal(assertReadOnlySql(sql).ok, true);
    const result = await pgliteQuery({ sql, sqlClient: client });
    assert.equal(result.ok, true, result.text);
    const path = (await db.query<{ search_path: string }>("show search_path")).rows[0].search_path;
    assert.equal(path, baselineSearchPath);
  });
});


describe("pglite_query guard: comment-strip / string-literal bypass (H12)", () => {
  let db: PGlite;
  let client: SqlLike;
  let baselineSearchPath = "";

  before(async () => {
    db = new PGlite();
    await db.exec("create table t(id serial primary key, v text); insert into t(v) values ('ok');");
    baselineSearchPath = (await db.query<{ search_path: string }>("show search_path")).rows[0].search_path;
    client = {
      query: async (q, p = []) => (await db.query(q, p)).rows as Record<string, unknown>[],
      exec: async (q) => {
        await db.exec(q);
      },
    };
  });
  after(async () => {
    await db.close();
  });

  const attacks = [
    "SELECT '--' AS a, set_config('search_path','evil',false)",
    "SELECT '/*' AS a, pg_sleep(60), '*/' AS b",
    "SELECT $$--$$ AS a, set_config('search_path','evil',false)",
    "SELECT $tag$/* hide *$tag$ AS a, pg_sleep(5)",
    "SELECT E'--' AS a, set_config('search_path','x',false)",
    "SELECT E'\\/*' AS a, pg_sleep(5), E'*/' AS b",
    "SELECT 'a' /* /* nested */ */, set_config('search_path','evil',false)",
    "SELECT '--' AS a, \"set_config\"('search_path','evil',false)",
  ];

  for (const sql of attacks) {
    it(`refuses string/comment smuggle: ${sql}`, async () => {
      assert.equal(assertReadOnlySql(sql).ok, false, `assertReadOnlySql should refuse: ${sql}`);
      const result = await pgliteQuery({ sql, sqlClient: client, timeoutMs: 500 });
      assert.equal(result.ok, false);
      assert.doesNotMatch(result.text, /rowCount/);
    });
  }

  it("allows legitimate queries that contain '--' or '/*' inside string literals", async () => {
    const cases = [
      "SELECT '--' AS dash, 1 AS n",
      "SELECT '/*' AS open, '*/' AS close, 2 AS n",
      "SELECT $$-- still literal$$ AS s, 3 AS n",
      "SELECT $q$/* not a comment *$q$ AS s, 4 AS n",
      "SELECT E'line\\n--not comment' AS s, 5 AS n",
    ];
    for (const sql of cases) {
      assert.equal(assertReadOnlySql(sql).ok, true, sql);
      const result = await pgliteQuery({ sql, sqlClient: client });
      assert.equal(result.ok, true, `${sql} -> ${result.text}`);
      assert.match(result.text, /rowCount/);
    }
  });

  it("runs reads inside BEGIN READ ONLY and restores session via RESET ALL", async () => {
    // Poison the session, then a guarded read must RESET it.
    await db.query("SELECT set_config('search_path', 'evil', false)");
    assert.equal((await db.query<{ search_path: string }>("show search_path")).rows[0].search_path, "evil");
    const result = await pgliteQuery({ sql: "SELECT v FROM t", sqlClient: client });
    assert.equal(result.ok, true, result.text);
    const path = (await db.query<{ search_path: string }>("show search_path")).rows[0].search_path;
    assert.equal(path, baselineSearchPath);
    assert.notEqual(path, "evil");
  });

  it("refuses writes even if the static guard were bypassed (READ ONLY txn)", async () => {
    // Directly exercise the RO wrapper path with a write that somehow passed the static check —
    // craft via client-only call simulating limitedSql. We assert BEGIN READ ONLY blocks INSERT
    // when used the same way pgliteQuery does.
    await client.exec?.("BEGIN READ ONLY");
    let failed = false;
    try {
      await client.query("INSERT INTO t(v) VALUES ('nope')");
    } catch {
      failed = true;
    }
    await client.exec?.("ROLLBACK");
    await client.exec?.("RESET ALL");
    assert.equal(failed, true);
    const n = (await db.query<{ n: number }>("select count(*)::int as n from t")).rows[0].n;
    assert.equal(n, 1);
  });
});

describe("pglite_query guard: CPU complexity (H15)", () => {
  let db: PGlite;
  let client: SqlLike;

  before(async () => {
    db = new PGlite();
    await db.waitReady;
    client = {
      query: async (q, p = []) => (await db.query(q, p)).rows as Record<string, unknown>[],
      exec: async (q) => {
        await db.exec(q);
      },
      engine: "pglite",
    };
  });
  after(async () => {
    await db.close();
  });

  it("refuses recursive CTEs before they run", () => {
    const sql = "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n < 1000000) SELECT * FROM t";
    const checked = assertReadOnlySql(sql);
    assert.equal(checked.ok, false);
    if (!checked.ok) assert.match(checked.text, /recursive/i);
  });

  it("refuses oversized generate_series spans", () => {
    const sql = "SELECT count(*)::int AS n FROM generate_series(1, 20000000)";
    const checked = assertReadOnlySql(sql);
    assert.equal(checked.ok, false);
    if (!checked.ok) assert.match(checked.text, /generate_series|10000/i);
  });

  it("refuses multiple generate_series (cross-join bomb)", () => {
    const sql = "SELECT * FROM generate_series(1, 100) a, generate_series(1, 100) b";
    const checked = assertReadOnlySql(sql);
    assert.equal(checked.ok, false);
    if (!checked.ok) assert.match(checked.text, /at most one generate_series/i);
  });

  it("refuses generate_series with non-literal bounds", () => {
    const sql = "SELECT * FROM generate_series(1, (SELECT 1000000))";
    const checked = assertReadOnlySql(sql);
    assert.equal(checked.ok, false);
  });

  it("allows a small generate_series and runs it without hanging the runner", async () => {
    let ticks = 0;
    const tick = setInterval(() => {
      ticks += 1;
    }, 20);
    try {
      const started = Date.now();
      const result = await pgliteQuery({
        sql: "SELECT count(*)::int AS n FROM generate_series(1, 100)",
        sqlClient: client,
        timeoutMs: 2000,
      });
      assert.equal(result.ok, true, result.text);
      assert.ok(Date.now() - started < 2000);
      assert.ok(ticks >= 0);
    } finally {
      clearInterval(tick);
    }
  });

  it("hostile oversized series is rejected without freezing the event loop", async () => {
    let ticks = 0;
    const tick = setInterval(() => {
      ticks += 1;
    }, 20);
    try {
      const started = Date.now();
      const result = await pgliteQuery({
        sql: "SELECT count(*)::int AS n FROM generate_series(1, 30000000)",
        sqlClient: client,
        timeoutMs: 200,
      });
      const elapsed = Date.now() - started;
      assert.equal(result.ok, false, result.text);
      assert.match(result.text, /generate_series|10000|refuses/i);
      assert.ok(elapsed < 500, `elapsed ${elapsed}ms — must not burn CPU`);
      // Give the interval at least one shot
      await new Promise((r) => setTimeout(r, 30));
      assert.ok(ticks >= 1, `expected event-loop ticks, got ${ticks}`);
    } finally {
      clearInterval(tick);
    }
  });
});
