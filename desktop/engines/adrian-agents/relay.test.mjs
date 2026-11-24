import assert from "node:assert/strict";
import test from "node:test";
import { humanNotice, pcBeat, readRelayEnv } from "./relay.mjs";

test("a missing Supabase key stops the PC", async () => {
  const result = await pcBeat(async () => { throw new Error("must not call"); }, {}, 1000, 1000, "ok");
  assert.equal(result.stopped, true);
  assert.match(result.refused, /not configured/);
  assert.equal(readRelayEnv({}).refused.includes("Supabase"), true);
  assert.equal(readRelayEnv({ VITE_SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" }).refused, undefined);
});

test("a configured relay renews the lease and Telegram stays a human notice", async () => {
  const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret", ADRIAN_TELEGRAM_USER_ID: "9" };
  let stored = null;
  const fetchImpl = async (url, options = {}) => {
    if (!options.method) return { ok: true, json: async () => stored ? [stored] : [] };
    stored = JSON.parse(options.body);
    return { ok: true, json: async () => [stored] };
  };
  const beat = await pcBeat(fetchImpl, env, 5000, 5000, "ok");
  assert.equal(beat.stopped, false);
  assert.equal(stored.owner, "pc");
  assert.equal(humanNotice(env, "8", "PC down").refused, "That Telegram user is not on the allowlist.");
  assert.equal(humanNotice(env, "9", "PC down").deviceToDevice, false);
});

test("PC lease writes have one winner and a stale owner cannot renew", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFile } = await import("node:fs/promises");
  const { readOwnership, writeOwnership } = await import("./relay.mjs");
  const db = new PGlite();
  const env = { SUPABASE_URL: "https://isolated.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-only" };
  try {
    await db.exec(await readFile(new URL("./mind_failover.sql", import.meta.url), "utf8"));
    const columns = new Set(["id", "owner", "epoch", "lease_expires", "flap_until", "paused", "going_down"]);
    let beforeWrite;
    let writes = 0;
    const fetchImpl = async (url, options) => {
      if (!options.method) return Response.json((await db.query("select * from mind_failover_ownership where id=1")).rows);
      if (beforeWrite) await beforeWrite();
      writes++;
      const data = JSON.parse(options.body);
      const keys = Object.keys(data);
      assert.ok(keys.every(key => columns.has(key)));
      assert.equal(options.headers.Prefer, "return=representation");
      const values = Object.values(data);
      let sql;
      if (options.method === "POST") {
        sql = 'insert into mind_failover_ownership (' + keys.join(',') + ') values (' +
          keys.map((_, i) => '$' + (i + 1)).join(',') + ') returning *';
      } else {
        assert.equal(options.method, "PATCH");
        const conditions = [];
        for (const [key, filter] of new URL(url).searchParams) {
          assert.ok(columns.has(key) && filter.startsWith("eq."));
          values.push(filter.slice(3));
          conditions.push(key + '=$' + values.length);
        }
        sql = 'update mind_failover_ownership set ' + keys.map((key,i) => key + '=$' + (i+1)).join(',') +
          (conditions.length ? ' where ' + conditions.join(' and ') : '') + ' returning *';
      }
      try {
        return Response.json((await db.query(sql, values)).rows);
      } catch (error) {
        if (error.code !== "23505") throw error;
        return new Response(null, {status: 409});
      }
    };
    const concurrentBeats = async now => {
      let arrivals = 0;
      const barrier = Promise.withResolvers();
      beforeWrite = () => {
        if (++arrivals === 2) barrier.resolve();
        return barrier.promise;
      };
      const results = await Promise.all([pcBeat(fetchImpl, env, now, now, "ok"), pcBeat(fetchImpl, env, now, now, "ok")]);
      beforeWrite = null;
      assert.deepEqual(results.map(result => result.stopped).sort(), [false, true]);
    };
    await concurrentBeats(1000); // both observe the row missing
    await concurrentBeats(2000); // both observe epoch 2
    const after = await readOwnership(fetchImpl, env);
    assert.equal(after.epoch, 3);
    // The owner changes after the PC has read the row and before its PATCH.
    beforeWrite = async () => {
      beforeWrite = null;
      await db.query("update mind_failover_ownership set owner='phone', epoch=4, flap_until=9000, going_down=true where id=1");
    };
    assert.equal((await pcBeat(fetchImpl, env, 3000, 3000, "ok")).stopped, true);
    const final = await readOwnership(fetchImpl, env);
    assert.equal(final.owner, "phone");
    assert.equal(final.epoch, 4);
    assert.equal(final.flapUntil, 9000);
    assert.equal(final.goingDown, true);
    const before = writes;
    assert.equal((await pcBeat(fetchImpl, env, 4000, 4000, "ok")).stopped, true);
    assert.match((await writeOwnership(fetchImpl, env, 4, {owner:"pc"}, 4000)).refused, /Cooldown/);
    assert.equal(writes, before);
  } finally {
    await db.close();
  }
});
