import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { callConfiguredProvider, routeSelectedModel } from "./provider-call.ts";
import { normalizeProviderUsage } from "./provider-usage.ts";
import { groupUsage, loadUsagePeriod, mergeUsageEntries, usageDateRange, usageExport, usageRetentionCutoff, usageTotals, type UsageReceipt } from "./usage-ledger.ts";
import { deleteUsageBefore, previewUsageRetention, readUsageLedger, trackUsageResponse, writeUsageReceipt } from "./usage-ledger.server.ts";
import { readJsonObjectBody } from "./request-body.ts";
import { decideRequestIsolation } from "./request-guard.ts";
import { emptyWorkspace, pushUsage } from "./workspace.ts";

test("C5 native adapters retain actual usage and request IDs without inventing missing counts", async () => {
  const fixtures = [
    { id: "openai", payload: { choices: [{ message: { content: "fixture" } }], usage: { prompt_tokens: 4, completion_tokens: 6 } } },
    { id: "openrouter", payload: { choices: [{ message: { content: "fixture" } }], usage: { prompt_tokens: 4, completion_tokens: 6 } } },
    { id: "anthropic", payload: { content: [{ type: "text", text: "fixture" }], usage: { input_tokens: 4, output_tokens: 6 } } },
    { id: "gemini", payload: { candidates: [{ content: { parts: [{ text: "fixture" }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 } } },
  ] as const;
  for (const f of fixtures) {
    let calls = 0, dispatched = 0;
    const result = await callConfiguredProvider({ id: f.id, model: f.id === "openrouter" ? "fixture/model:free" : undefined, prompt: "fixture", key: "fixture-key", onDispatch: () => { dispatched++; }, fetch: async () => { calls++; return Response.json(f.payload, { headers: { "x-request-id": "fixture-request" } }); } });
    assert.equal(result.ok, true); assert.deepEqual(result.usage, { prompt_tokens: 4, completion_tokens: 6 });
    assert.equal(result.requestId, "fixture-request"); assert.equal(calls, 1); assert.equal(dispatched, 1);
  }
  assert.equal(normalizeProviderUsage("openai", { usage: { prompt_tokens: -1, completion_tokens: "6" } }), null);
  assert.deepEqual(normalizeProviderUsage("gemini", { usageMetadata: { promptTokenCount: 0 } }), { prompt_tokens: 0 });
  let dispatches = 0;
  await routeSelectedModel({ id: "ollama", prompt: "fixture", env: {}, fetch: async () => { throw new Error("must not call"); }, onDispatch: () => { dispatches++; } });
  assert.equal(dispatches, 0);
});

const receipt = (operationId = "op-1", stage = "answer"): UsageReceipt => ({ id: `${operationId}/${stage}`, operationId, stage, chatId: "chat", at: "2026-11-01T00:00:00Z", provider: "gemini", model: "unknown", requestId: null, promptTokens: null, completionTokens: null, outcome: "unconfirmed", dispatched: true });

test("C5 usage captures split SSE, interrupted streams, and keeps helper execution identities distinct", async () => {
  const records: UsageReceipt[] = [];
  const text = 'event: done\ndata: {"text":"fixture","provider":"gemini","model":"fixture-model","usage":{"prompt_tokens":12},"requestId":"fixture-r"}\n\n';
  const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(text.slice(0, 21))); controller.enqueue(new TextEncoder().encode(text.slice(21))); controller.close(); } });
  const tracked = trackUsageResponse(new Response(source, { headers: { "content-type": "text/event-stream" } }), receipt(), async row => { records.push(row); });
  assert.equal(await tracked.text(), text);
  assert.equal(records.length, 1); assert.equal(records[0].outcome, "completed");
  assert.equal(records[0].promptTokens, 12); assert.equal(records[0].completionTokens, null);
  assert.equal(records[0].requestId, "fixture-r");
  const interrupted = trackUsageResponse(new Response("event: delta\ndata: {\"text\":\"partial\"}\n\n", { headers: { "content-type": "text/event-stream" } }), receipt("op-lost"), async row => { records.push(row); });
  await interrupted.text(); assert.equal(records.at(-1)?.outcome, "unconfirmed");
  let ws = pushUsage(emptyWorkspace(), records[0]);
  ws = pushUsage(ws, { ...records[0], id: "other-browser-uuid" });
  ws = pushUsage(ws, receipt("op-1", "helper:openai"));
  ws = pushUsage(ws, receipt("op-2"));
  assert.equal(ws.usage.length, 3);
  assert.deepEqual(usageTotals(ws.usage), { operations: 3, incomplete: 3, knownPromptTokens: 12, knownCompletionTokens: 0 });
  assert.equal(mergeUsageEntries([...ws.usage, { ...ws.usage.find(row => row.outcome === "completed")!, outcome: "unconfirmed", kind: "unknown" }]).find(row => row.operationId === "op-1" && row.stage === "answer")?.outcome, "completed");
});

test("C5 durable usage exceeds the UI cache, isolates owners, and never downgrades completed receipts", async () => {
  const db = new PGlite();
  const sql = (async (parts: TemplateStringsArray, ...values: unknown[]) => (await db.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)).rows) as Sql;
  try {
    await db.exec(await readFile(new URL("../../../migrations/0020_c5_usage_ledger.sql", import.meta.url), "utf8"));
    for (let i = 0; i < 205; i++) await writeUsageReceipt(sql, "owner-A", receipt(`operation-${i}`));
    await writeUsageReceipt(sql, "owner-A", { ...receipt("operation-0"), outcome: "completed", promptTokens: 7 });
    await writeUsageReceipt(sql, "owner-A", receipt("operation-0"));
    await writeUsageReceipt(sql, "owner-A", { ...receipt("operation-0"), outcome: "completed" });
    await writeUsageReceipt(sql, "owner-B", receipt("operation-0"));
    const first = await readUsageLedger(sql, "owner-A", { limit: 200 });
    assert.equal(first.entries.length, 200); assert.equal(first.nextOffset, 200);
    const second = await readUsageLedger(sql, "owner-A", { offset: 200, limit: 200 });
    assert.equal(second.entries.length, 5); assert.equal(second.nextOffset, null);
    const completed = [...first.entries, ...second.entries].find(row => row.operationId === "operation-0")!;
    assert.equal(completed.outcome, "completed"); assert.equal(completed.promptTokens, 7);
    assert.equal((await readUsageLedger(sql, "owner-B")).entries.length, 1);
    assert.equal((await readUsageLedger(sql, "owner-C")).entries.length, 0);
  } finally { await db.close(); }
});

test("C5 usage pagination sends only bounded finite integers and continues beyond old offset caps", async () => {
  const cases = [
    { input: { limit: Number.NaN, offset: Number.NaN }, limit: 201, offset: 0 },
    { input: { limit: Infinity, offset: -Infinity }, limit: 201, offset: 0 },
    { input: { limit: -4, offset: -2 }, limit: 2, offset: 0 },
    { input: { limit: 2.9, offset: 3.8 }, limit: 3, offset: 3 },
    { input: { limit: 900, offset: 1_000_500 }, limit: 501, offset: 1_000_500 },
  ];
  for (const fixture of cases) {
    let parameters: unknown[] = [];
    const sql = (async (_parts: TemplateStringsArray, ...values: unknown[]) => { parameters = values; return []; }) as unknown as Sql;
    await readUsageLedger(sql, "fixture-owner", fixture.input);
    assert.equal(parameters[3], fixture.limit);
    assert.equal(parameters[4], fixture.offset);
  }
});

test("C5 daily and monthly UTC usage groups retain provider/channel attribution and unknown counts", () => {
  const first = { ...receipt("first"), at: "2026-01-31T23:30:00-02:00", provider: "gemini", channel: "chat" as const, outcome: "completed" as const, promptTokens: 4, completionTokens: 2 };
  const rows = [first, { ...first, id: "duplicate-client-id", outcome: "unconfirmed" as const },
    { ...receipt("second"), at: "2026-02-01T00:30:00Z", provider: "openai", channel: "orchestrator" as const, promptTokens: 3 },
    { ...receipt("old"), at: "2026-01-31T23:00:00Z", provider: "gemini", promptTokens: 1, completionTokens: 0 }];
  const days = groupUsage(rows, "day");
  assert.deepEqual(days.map(row => [row.key, row.operations, row.knownPromptTokens, row.incomplete]), [["2026-01-31", 1, 1, 0], ["2026-02-01", 2, 7, 1]]);
  assert.deepEqual(groupUsage(rows, "month").map(row => [row.key, row.operations]), [["2026-01", 1], ["2026-02", 2]]);
  assert.deepEqual(groupUsage(rows, "provider").map(row => [row.key, row.operations]), [["gemini", 2], ["openai", 1]]);
  assert.deepEqual(groupUsage(rows, "channel").map(row => [row.key, row.operations]), [["chat", 1], ["orchestrator", 1], ["unknown", 1]]);
  assert.equal(usageRetentionCutoff("2026-02-30"), null);
  assert.equal(usageRetentionCutoff("2999-01-01"), null);
  assert.equal(usageDateRange("2026-02-01", "2026-01-01"), null);
  assert.deepEqual(usageDateRange("2026-01-31", "2026-02-01", Date.parse("2026-02-02T12:00:00Z")), { from: "2026-01-31T00:00:00.000Z", to: "2026-02-01T23:59:59.999Z" });
});

test("C5 period loading includes every page or exports explicit partial coverage at its bound", async () => {
  const range = { from: "2026-01-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z" };
  const rows = Array.from({ length: 501 }, (_, i) => ({ ...receipt(`entry-${i}`), promptTokens: 1, completionTokens: 2, channel: "agent" as const }));
  const offsets: number[] = [];
  const page = async ({ offset, limit, from, to }: { offset: number; limit: number; from: string; to: string }) => {
    assert.equal(from, range.from); assert.equal(to, range.to); offsets.push(offset);
    return { ...range, entries: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null };
  };
  const complete = await loadUsagePeriod(page, range);
  assert.deepEqual(offsets, [0, 500]); assert.equal(complete.complete, true); assert.equal(complete.entries.length, 501);
  const all = usageExport(complete);
  assert.equal(all.complete, true); assert.equal(all.totals.operations, 501); assert.equal(all.totals.knownPromptTokens, 501); assert.equal(all.channels[0].key, "agent");
  const partial = usageExport(await loadUsagePeriod(page, range, 500));
  assert.equal(partial.complete, false); assert.equal(partial.nextOffset, 500); assert.equal(partial.loadedCount, 500); assert.match(partial.coverage, /Partial export/);
  await assert.rejects(loadUsagePeriod(async () => ({ ...range, entries: [rows[0]], nextOffset: 0 }), range), /did not advance/);
});

test("C5 confirmed retention deletes only a bounded owner batch strictly before the UTC cutoff", async () => {
  const db = new PGlite();
  const sql = (async (parts: TemplateStringsArray, ...values: unknown[]) => (await db.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)).rows) as Sql;
  try {
    await db.exec(await readFile(new URL("../../../migrations/0020_c5_usage_ledger.sql", import.meta.url), "utf8"));
    await db.exec("create table mind_turn_receipt (user_id text, operation_id text); insert into mind_turn_receipt values ('owner-A', 'protected');");
    await db.query("insert into mind_usage_ledger (user_id,operation_id,stage,at,payload) select 'owner-A', 'old-' || n, 'answer', '2026-01-01T00:00:00Z'::timestamptz, '{}'::jsonb from generate_series(1,1005) n");
    await writeUsageReceipt(sql, "owner-B", { ...receipt("other-owner"), at: "2026-01-01T00:00:00Z" });
    await writeUsageReceipt(sql, "owner-A", { ...receipt("at-cutoff"), at: "2026-02-01T00:00:00Z" });
    assert.equal((await previewUsageRetention(sql, "owner-A", "2026-02-01")).matching, 1005);
    await assert.rejects(deleteUsageBefore(sql, "owner-A", "2026-02-01", "DELETE_USAGE_BEFORE:2026-01-01T00:00:00.000Z"), /Confirm the exact/);
    assert.equal((await previewUsageRetention(sql, "owner-A", "2026-02-01")).matching, 1005);
    const first = await deleteUsageBefore(sql, "owner-A", "2026-02-01", "DELETE_USAGE_BEFORE:2026-02-01T00:00:00.000Z");
    assert.equal(first.deleted, 1000); assert.equal(first.remaining, 5);
    assert.equal((await readUsageLedger(sql, "owner-B")).entries.length, 1);
    const second = await deleteUsageBefore(sql, "owner-A", "2026-02-01", "DELETE_USAGE_BEFORE:2026-02-01T00:00:00.000Z");
    assert.equal(second.deleted, 5); assert.equal(second.remaining, 0);
    assert.equal((await readUsageLedger(sql, "owner-A")).entries[0].operationId, "at-cutoff");
    assert.equal((await db.query("select * from mind_turn_receipt")).rows.length, 1);
  } finally { await db.close(); }
});

test("C5 actual usage HTTP handler requires exact owner confirmation and blocks cross-site deletion", async () => {
  const source = await readFile(new URL("../../routes/api/mind/usage.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("usage.ts", source, ts.ScriptTarget.Latest, true);
  const handler = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "usageHistory");
  assert.ok(handler);
  const executable = ts.transpileModule(handler.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported: { usageHistory?: (request: Request) => Promise<Response> } = {};
  let deletes = 0, reads = 0;
  runInNewContext(executable, {
    exports: exported, Response, URL, Number, Date, decideRequestIsolation, readJsonObjectBody, usageRetentionCutoff,
    requireUserId: async () => "owner-A", getSql: async () => ({}),
    previewUsageRetention: async () => ({ matching: 3 }),
    readUsageLedger: async () => { reads++; return { entries: [] }; },
    deleteUsageBefore: async (_sql: unknown, owner: string, before: string, confirmation: string) => { assert.equal(owner, "owner-A"); assert.equal(before, "2026-02-01"); assert.equal(confirmation, "DELETE_USAGE_BEFORE:2026-02-01T00:00:00.000Z"); deletes++; return { deleted: 3, remaining: 0 }; },
  });
  const send = (body: Record<string, unknown>, extra: Record<string, string> = {}) => exported.usageHistory!(new Request("https://fixture.example/api/mind/usage", { method: "DELETE", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) }));
  const valid = { ownerId: "owner-A", before: "2026-02-01", confirmation: "DELETE_USAGE_BEFORE:2026-02-01T00:00:00.000Z" };
  assert.equal((await send({ ...valid, ownerId: "owner-B" })).status, 403);
  assert.equal((await send({ ...valid, confirmation: "DELETE" })).status, 400);
  assert.equal((await send(valid, { "sec-fetch-site": "cross-site", origin: "https://elsewhere.example" })).status, 403);
  assert.equal(deletes, 0);
  assert.equal((await exported.usageHistory!(new Request("https://fixture.example/api/mind/usage?ownerId=owner-B"))).status, 403);
  assert.equal(reads, 0);
  assert.equal((await send(valid)).status, 200); assert.equal(deletes, 1);
});

test("C5 actual retention UI requires a fresh review after an unconfirmed deletion response", async () => {
  const source = await readFile(new URL("../../components/mind/usage-history.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("usage-history.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "UsageHistory");
  const handler = component?.body?.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "deleteReviewed");
  assert.ok(handler);
  const code = ts.transpileModule(handler.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const before = "2026-02-01T00:00:00.000Z";
  const reviewed = { before, ownerId: "owner-A", matching: 1005, batchLimit: 1000 };
  const state = { review: reviewed as typeof reviewed | null, confirmation: "2026-02-01", error: "", requests: 0 };
  const context: Record<string, unknown> = {
    review: reviewed, ownerId: "owner-A", beforeDate: "2026-02-01", confirmation: "2026-02-01", Error,
    start: () => ({ owner: "owner-A", controller: new AbortController(), current: () => true }), finish: () => {},
    request: async () => { state.requests++; throw new Error("fixture response lost after server receipt"); },
    setReview: (value: typeof reviewed | null) => { state.review = value; },
    setConfirmation: (value: string) => { state.confirmation = value; },
    setError: (value: string) => { state.error = value; },
  };
  runInNewContext(`${code}\nthis.runDelete = deleteReviewed;`, context);
  await (context.runDelete as () => Promise<void>)();
  assert.equal(state.requests, 1); assert.equal(state.review, null); assert.equal(state.confirmation, "");
  assert.match(state.error, /response lost/);
  // Model the next render: the old confirmation no longer authorizes a batch.
  context.review = state.review; context.confirmation = state.confirmation;
  await (context.runDelete as () => Promise<void>)();
  assert.equal(state.requests, 1);
});
