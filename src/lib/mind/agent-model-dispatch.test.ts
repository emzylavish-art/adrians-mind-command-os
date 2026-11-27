import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { createBudgetedAgentModel, type AgentDispatchDependencies } from "./agent-model-dispatch.server.ts";
import { runBoundedAgent } from "./agent.ts";
import { emptyWorkspace } from "./workspace.ts";
import { DEFAULT_FINANCIAL_POLICY, type FinancialPolicy } from "./financial-policy.ts";
import { approveFinancialRequest, readFinancialSnapshot, saveFinancialPolicy } from "./financial-policy.server.ts";
import { readDispatchPolicy, reserveOwnerDispatch, settleOwnerDispatch } from "./dispatch-controls.server.ts";

const pg = new PGlite();
function sqlFor(db: Pick<PGlite, "query"> & Partial<Pick<PGlite, "transaction">>): Sql {
  const sql = (async (parts: TemplateStringsArray, ...args: unknown[]) => (await db.query(parts.reduce((all, part, i) => all + (i ? `$${i}` : "") + part, ""), args)).rows) as Sql;
  sql.query = async <T = Record<string, unknown>>(query: string, args: unknown[] = []) => (await db.query(query, args)).rows as T[];
  if (db.transaction) sql.transaction = work => db.transaction!(tx => work(sqlFor(tx)));
  return sql;
}
const sql = sqlFor(pg);
const NOW = Date.parse("2026-11-26T12:00:00.000Z");
let serial = 0;
const signal = () => new AbortController().signal;
const options = { model: "grok-fixture-exact", temperature: 0.2, max_tokens: 500 };
const key = "fixture-key-not-real";
before(async () => {
  await pg.waitReady;
  for (const migration of ["0019_c3_dispatch_controls.sql", "0021_c3_financial_policy.sql"]) await pg.exec(readFileSync(new URL(`../../../migrations/${migration}`, import.meta.url), "utf8"));
});
after(async () => pg.close());

async function owner(changes: Partial<FinancialPolicy> = {}) {
  const id = `agent-budget-owner-${++serial}`;
  assert.deepEqual(await saveFinancialPolicy(id, {
    ...structuredClone(DEFAULT_FINANCIAL_POLICY), enabled: true, expectedRevision: 0,
    dailyLimitMicros: 10_000_000, weeklyLimitMicros: 10_000_000, monthlyLimitMicros: 10_000_000,
    taskLimitMicros: 10_000_000, approvalAboveMicros: 10_000_000,
    ceilings: [{ provider: "xai", model: options.model, ceilingMicros: 250_000, expiresAt: "2027-12-31T00:00:00.000Z", note: "Fixture owner ceiling", basis: "owner_estimate" }],
    ...changes,
  }, sql), { ok: true });
  return id;
}
function adapter(ownerId: string, overrides: AgentDispatchDependencies = {}, identity: { operationId?: string; taskId?: string; projectId?: string } = {}) {
  return createBudgetedAgentModel({ ownerId, apiKey: key, signal: signal(), options, operationId: `agent-run-${++serial}`, projectId: "project-fixture", ...identity }, {
    halt: async () => "off", memory: async () => ({ ok: true }), catalogue: async () => ({ ok: true }), resolveKey: () => ({ ok: true, key }),
    reserve: (id, context) => reserveOwnerDispatch(id, sql, NOW, context),
    settle: (id, reservationId, receipt) => settleOwnerDispatch(id, reservationId, receipt, sql),
    fetchImpl: async () => { throw new Error("No network is allowed in this fixture."); },
    ...overrides,
  });
}
async function run(controller: ReturnType<typeof adapter>, goal = "List the current projects", execute?: Parameters<typeof runBoundedAgent>[0]["execute"]) {
  const ws = emptyWorkspace();
  ws.projects = [{ id: "project-fixture", name: "Saved project", description: "", createdAt: "2026-01-01T00:00:00.000Z" }];
  return controller.finish(await runBoundedAgent({ ws, goal, model: controller.model, signal: signal(), autonomy: "ask", halted: false, approved: true, execute }));
}
function reply(text = "Fixture answer") { return Response.json({ model: "grok-fixture-reported", choices: [{ message: { content: text } }], usage: { prompt_tokens: 20, completion_tokens: 4, cost: 0.001 } }, { headers: { "x-request-id": "provider-fixture-receipt" } }); }
function toolReply() { return Response.json({ model: options.model, choices: [{ message: { content: "", tool_calls: [{ id: "call-projects", function: { name: "list_projects", arguments: "{}" } }] } }] }); }

test("initial monetary denial makes zero calls and preserves exact operation identity for review", async () => {
  const id = await owner({ approvalAboveMicros: 0 });
  let calls = 0;
  const deps = { fetchImpl: async () => { calls++; return reply(); } };
  const first = await run(adapter(id, deps, { operationId: "same-reviewed-agent" }), "Exact original goal");
  assert.equal(first.ok, false);
  assert.equal(first.dispatched, false);
  assert.ok(first.approvalId);
  assert.equal(first.operationId, "same-reviewed-agent");
  assert.equal(first.modelRounds[0]!.state, "not_sent");
  assert.equal(calls, 0);
  assert.equal((await readDispatchPolicy(id, sql, NOW)).usedToday, 0);
  await approveFinancialRequest(id, first.approvalId!, true, sql, NOW);
  const changed = await run(adapter(id, deps, { operationId: first.operationId }), "Different goal cannot inherit approval");
  assert.equal(changed.dispatched, false);
  assert.notEqual(changed.approvalId, first.approvalId);
  assert.equal(calls, 0);
  const exact = await run(adapter(id, deps, { operationId: first.operationId }), "Exact original goal");
  assert.equal(exact.ok, true);
  assert.equal(calls, 1);
  assert.equal(exact.dispatched, undefined);
  assert.equal(exact.modelRounds[0]!.reportedModel, "grok-fixture-reported");
  const ledger = (await readFinancialSnapshot(id, sql, NOW)).ledger;
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]!.state, "unknown");
  assert.equal(ledger[0]!.actualMicros, null, "xAI-shaped token/cost data is not an established USD receipt");
});

test("every model round reserves separately under the same project and task; a later cap preserves the tool log", async () => {
  const id = await owner({ taskLimitMicros: 400_000 });
  let calls = 0;
  const controller = adapter(id, { fetchImpl: async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(String(init?.body)).model, options.model);
    return toolReply();
  } }, { operationId: "bounded-agent", taskId: "shared-agent-task", projectId: "original-project" });
  const result = await run(controller);
  assert.equal(result.ok, false);
  assert.match(result.error!, /task/i);
  assert.equal(calls, 1);
  assert.equal(result.dispatched, undefined);
  assert.equal(result.approvalId, undefined);
  assert.equal(result.retryable, false);
  assert.equal(result.log.length, 1);
  assert.equal(result.log[0]!.tool, "list_projects");
  assert.equal(result.log[0]!.ok, true);
  assert.deepEqual(result.modelRounds.map(row => [row.operationId, row.state]), [["bounded-agent:agent-model-1", "responded"], ["bounded-agent:agent-model-2", "not_sent"]]);
  const snapshot = await readFinancialSnapshot(id, sql, NOW);
  assert.equal(snapshot.ledger.length, 1);
  assert.equal(snapshot.ledger[0]!.taskId, "shared-agent-task");
  assert.equal(snapshot.ledger[0]!.projectId, "original-project");
  assert.equal(snapshot.totals.dayMicros, 250_000);
});

test("two successful rounds have distinct immutable digests and unknown-cost holds, without provider fallback", async () => {
  const id = await owner();
  let calls = 0;
  const result = await run(adapter(id, { fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.x.ai/v1/chat/completions");
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, options.model);
    return ++calls === 1 ? toolReply() : reply();
  } }));
  assert.equal(result.ok, true);
  assert.equal(result.text, "Fixture answer");
  assert.equal(result.log.length, 1);
  assert.equal(calls, 2);
  assert.equal(result.modelRounds[1]!.requestId, "provider-fixture-receipt");
  assert.deepEqual(result.modelRounds[1]!.usage, { prompt_tokens: 20, completion_tokens: 4 });
  const snapshot = await readFinancialSnapshot(id, sql, NOW);
  assert.equal(snapshot.ledger.length, 2);
  const hashes = await sql<{ request_hash: string }>`select request_hash from mind_financial_ledger where user_id=${id}`;
  assert.equal(new Set(hashes.map(row => row.request_hash)).size, 2);
  assert.equal(new Set(snapshot.ledger.map(row => row.taskId)).size, 1);
  assert.ok(snapshot.ledger.every(row => row.state === "unknown" && row.actualMicros === null));
  assert.equal(snapshot.totals.dayMicros, 500_000);
  assert.equal((await readDispatchPolicy(id, sql, NOW)).usedToday, 2);
});

for (const loss of ["halt", "privacy", "catalogue", "credential"] as const) test(`a changed ${loss} between model rounds prevents the next provider dispatch`, async () => {
  const id = await owner();
  let changed = false, calls = 0;
  const savedContextChecks: boolean[] = [];
  const result = await run(adapter(id, {
    halt: async () => changed && loss === "halt" ? "on" : "off",
    memory: async (_owner, used) => { savedContextChecks.push(used); return changed && used && loss === "privacy" ? { ok: false, error: "Saved memory is suspended." } : { ok: true }; },
    catalogue: async () => changed && loss === "catalogue" ? { ok: false, error: "Selected model is no longer available." } : { ok: true },
    resolveKey: () => ({ ok: true, key: changed && loss === "credential" ? "different-fixture-key" : key }),
    fetchImpl: async () => { calls++; return toolReply(); },
  }), undefined, async () => { changed = true; return { ok: true, lines: ["Saved project"] }; });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.equal(result.log[0]!.detail, "Saved project");
  assert.equal(result.modelRounds[1]!.state, "not_sent");
  assert.equal(result.dispatched, undefined);
  if (loss === "privacy") assert.ok(savedContextChecks.includes(true));
  assert.equal((await readFinancialSnapshot(id, sql, NOW)).ledger.length, 1);
});

test("a stop change during reservation releases known-unsent cost but cannot replay a closed operation", async () => {
  const id = await owner();
  let halted = false, calls = 0;
  const result = await run(adapter(id, {
    halt: async () => halted ? "on" : "off",
    reserve: async (ownerId, context) => { const reservation = await reserveOwnerDispatch(ownerId, sql, NOW, context); halted = true; return reservation; },
    fetchImpl: async () => { calls++; return reply(); },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.dispatched, false);
  assert.equal(result.retryable, false);
  assert.equal(calls, 0);
  const snapshot = await readFinancialSnapshot(id, sql, NOW);
  assert.equal(snapshot.ledger[0]!.state, "released");
  assert.equal(snapshot.totals.dayMicros, 0);
});

test("an ambiguous fetch stays unknown and the same operation cannot call the provider again", async () => {
  const id = await owner();
  let calls = 0;
  const dependencies = { fetchImpl: async () => { calls++; throw new Error("Simulated connection loss after request dispatch"); } };
  const identity = { operationId: "unknown-agent-operation" };
  const first = await run(adapter(id, dependencies, identity));
  assert.equal(first.ok, false);
  assert.equal(first.dispatched, undefined);
  assert.equal(first.retryable, false);
  assert.equal(first.modelRounds[0]!.state, "unknown");
  const next = await run(adapter(id, dependencies, identity));
  assert.equal(next.ok, false);
  assert.equal(calls, 1);
  const snapshot = await readFinancialSnapshot(id, sql, NOW);
  assert.equal(snapshot.ledger[0]!.state, "unknown");
  assert.equal(snapshot.totals.dayMicros, 250_000);
});

test("settlement outage does not hide an already delivered answer or release its hold", async () => {
  const id = await owner();
  const result = await run(adapter(id, { fetchImpl: async () => reply(), settle: async () => { throw new Error("Fixture settlement outage"); } }));
  assert.equal(result.ok, true);
  assert.equal(result.text, "Fixture answer");
  assert.equal(result.modelRounds[0]!.state, "responded");
  const snapshot = await readFinancialSnapshot(id, sql, NOW);
  assert.equal(snapshot.totals.dayMicros, 250_000);
  assert.equal(snapshot.ledger[0]!.actualMicros, null);
});

test("the HTTP agent mounts the guarded per-round adapter and returns receipts without bypass fetch", () => {
  const source = readFileSync(new URL("./agent-run.server.ts", import.meta.url), "utf8");
  assert.match(source, /createBudgetedAgentModel\(/);
  assert.match(source, /model: budgeted\.model/);
  assert.match(source, /budgeted\.finish\(await runBoundedAgent\(/);
  assert.match(source, /\.\.\.result/);
  assert.doesNotMatch(source, /fetch\("https:\/\/api\.x\.ai/);
});
