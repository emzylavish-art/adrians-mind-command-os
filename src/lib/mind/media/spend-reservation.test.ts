import assert from "node:assert/strict";
import { test } from "node:test";
import { generateImagineImages } from "./imagine.ts";
import { imagineUsage } from "./spend-ledger.ts";

test("one slot permits one provider dispatch and preserves an uncertain delivery", async (t) => {
  // The database is imported lazily; force the per-test-process embedded database.
  for (const key of ["DATABASE_URL", "POSTGRES_URL", "VERCEL", "MIND_IMAGINE_DAILY_CAP"]) {
    const old = process.env[key];
    t.after(() => { if (old == null) delete process.env[key]; else process.env[key] = old; });
    delete process.env[key];
  }
  t.after(async () => {
    const runtime = globalThis as typeof globalThis & { __pgliteInstance__?: Promise<{ close(): Promise<void> }> };
    await (await runtime.__pgliteInstance__)?.close();
  });
  let calls = 0;
  const ownerId = crypto.randomUUID();
  const run = () => generateImagineImages({ prompt: "a test pixel" }, {
    apiKey: "test", reserveDispatch: async () => ({ ok: true }), meter: { ownerId },
    fetchImpl: async () => { calls++; throw new Error("Mock response lost"); },
  });
  process.env.MIND_IMAGINE_DAILY_CAP = "0";
  assert.equal((await run()).ok, false);
  assert.equal(calls, 0);
  process.env.MIND_IMAGINE_DAILY_CAP = "1";
  const results = await Promise.all([run(), run()]);
  assert.equal(calls, 1, JSON.stringify(results));
  assert.equal(results.filter(result => !result.ok && result.status === 429).length, 1);
  const summary = await imagineUsage(ownerId);
  assert.equal(summary.count, 1);
  assert.equal(summary.remaining, 0);
  assert.equal(summary.unconfirmed, 1);
});
