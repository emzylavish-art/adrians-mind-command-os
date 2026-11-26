import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { callConfiguredProvider, routeSelectedModel } from "./provider-call.ts";
import { normalizeProviderUsage } from "./provider-usage.ts";
import { mergeUsageEntries, usageTotals, type UsageReceipt } from "./usage-ledger.ts";
import { readUsageLedger, trackUsageResponse, writeUsageReceipt } from "./usage-ledger.server.ts";
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
