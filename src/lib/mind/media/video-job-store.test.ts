import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../../db.ts";
import { durableVideoJobs } from "./video-job-store.server.ts";
import { startVideoJob } from "./video-jobs.ts";

const database = new PGlite();
const sql = (async () => { throw new Error("This fixture uses structured queries only"); }) as unknown as Sql;
sql.query = async <T = Record<string, unknown>>(query: string, params: unknown[] = []) => (await database.query(query, params)).rows as T[];
before(async () => { await database.waitReady; for (const file of ["0020_c3_media_jobs.sql", "0022_c3_media_request_identity.sql"]) await database.exec(readFileSync(new URL(`../../../../migrations/${file}`, import.meta.url), "utf8")); });
after(async () => { await database.close(); });

test("only an explicit unchanged retry can claim a blocked unsent job, atomically once", async () => {
  const store = await durableVideoJobs(sql), operationId = crypto.randomUUID();
  const input = { operationId, prompt: "Synthetic original", chatId: "chat-a", projectId: "project-a", taskId: "task-a", duration: 7 };
  let gateCalls = 0, providerCalls = 0;
  const start = async () => {
    gateCalls++;
    if (gateCalls === 1) return { ok: false as const, error: "Review this fixture request", status: 409, dispatched: false, approvalId: "a".repeat(64) };
    providerCalls++; return { ok: true as const, requestId: "fixture-provider-job", model: "fixture", state: "pending" as const };
  };
  const blocked = await startVideoJob("owner-a", input, { store, start });
  assert.equal(blocked.ok, false); assert.equal(blocked.job?.state, "blocked");
  if (!blocked.ok) assert.equal(blocked.approvalId, "a".repeat(64));
  assert.equal((await startVideoJob("owner-a", input, { store, start })).ok, false);
  assert.equal((await startVideoJob("owner-a", { ...input, retryBlocked: true, prompt: "Changed prompt" }, { store, start })).ok, false);
  assert.equal(gateCalls, 1);
  const attempts = await Promise.all([1, 2].map(() => startVideoJob("owner-a", { ...input, retryBlocked: true }, { store, start })));
  assert.ok(attempts.some(result => result.ok)); assert.ok(attempts.every(result => result.ok || result.status === 409)); assert.equal(gateCalls, 2); assert.equal(providerCalls, 1);
  const received = await store.get("owner-a", operationId);
  assert.equal(received?.state, "accepted"); assert.equal(received?.projectId, "project-a"); assert.equal(received?.taskId, "task-a");
  assert.equal(await store.get("owner-b", operationId), null);
  await startVideoJob("owner-a", { ...input, retryBlocked: true }, { store, start });
  assert.equal(providerCalls, 1);
});

test("Temporary job identity survives without prompt text and rejects a changed prompt after approval", async () => {
  const store = await durableVideoJobs(sql), operationId = crypto.randomUUID();
  const input = { operationId, prompt: "Private synthetic phrase", temporary: true };
  let calls = 0;
  const start = async () => { calls++; return { ok: false as const, error: "Fixture blocked before send", status: 503, dispatched: false }; };
  const blocked = await startVideoJob("temporary-owner", input, { store, start });
  assert.equal(blocked.job?.state, "blocked");
  const saved = await store.get("temporary-owner", operationId);
  assert.equal(saved?.prompt, ""); assert.match(saved?.requestHash || "", /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(saved).includes("Private synthetic phrase"), false);
  assert.equal((await startVideoJob("temporary-owner", { ...input, retryBlocked: true, prompt: "A different phrase" }, { store, start })).ok, false);
  assert.equal(calls, 1);
  await startVideoJob("temporary-owner", { ...input, retryBlocked: true }, { store, start });
  assert.equal(calls, 2);
});

test("an unconfirmed provider outcome cannot be reclaimed by explicit retry", async () => {
  const store = await durableVideoJobs(sql), operationId = crypto.randomUUID(); let calls = 0;
  const input = { operationId, prompt: "Fixture interruption" };
  const start = async () => { calls++; throw new Error("Synthetic lost response after dispatch"); };
  const uncertain = await startVideoJob("unknown-owner", input, { store, start });
  assert.equal(uncertain.job?.state, "unconfirmed");
  await startVideoJob("unknown-owner", { ...input, retryBlocked: true }, { store, start });
  assert.equal(calls, 1);
});
