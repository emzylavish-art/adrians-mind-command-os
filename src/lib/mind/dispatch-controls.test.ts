import assert from "node:assert/strict";
import test from "node:test";
import type { Sql } from "../db.ts";
import { DEFAULT_FINANCIAL_POLICY } from "./financial-policy.ts";
import { reserveOwnerDispatch } from "./dispatch-controls.server.ts";
function fixture(limit = 1000, paused = false) {
  const counts = new Map<string, number>(); let tail = Promise.resolve();
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?"); const owner = String(values[0]);
    if (query.startsWith("select policy,revision from mind_financial_policy")) return [{ policy: DEFAULT_FINANCIAL_POLICY, revision: 1 }];
    if (query.startsWith("select paused")) return [{ paused, daily_limit: limit }];
    if (query.startsWith("select bucket")) return [values[1], values[2]].flatMap((bucket) => counts.has(`${owner}:${bucket}`) ? [{ bucket, used: counts.get(`${owner}:${bucket}`) }] : []);
    if (query.startsWith("insert into mind_dispatch_bucket")) { const key = `${owner}:${values[1]}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
    return [];
  }) as unknown as Sql;
  sql.transaction = async (work) => { let release!: () => void; const previous = tail; tail = new Promise((resolve) => { release = resolve; }); await previous; try { return await work(sql); } finally { release(); } };
  return { sql, counts };
}
test("concurrent workers cannot exceed the shared per-dispatch minute budget", async () => { const { sql } = fixture(); const results = await Promise.all(Array.from({ length: 30 }, () => reserveOwnerDispatch("a", sql, 100000))); assert.equal(results.filter((row) => row.ok).length, 24); assert.equal((await reserveOwnerDispatch("b", sql, 100000)).ok, true); assert.equal((await reserveOwnerDispatch("a", sql, 160000)).ok, true); });
test("account pause, day limit and unavailable atomic storage block dispatch", async () => { const paused = fixture(1000, true); assert.equal((await reserveOwnerDispatch("a", paused.sql)).ok, false); const { sql } = fixture(1); assert.equal((await reserveOwnerDispatch("a", sql, 100000)).ok, true); assert.equal((await reserveOwnerDispatch("a", sql, 200000)).ok, false); const broken = fixture().sql; broken.transaction = undefined; const denied = await reserveOwnerDispatch("a", broken); assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.status, 503); });
