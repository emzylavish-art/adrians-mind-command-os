import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeMindTurn } from "./live-turn.ts";
import { modelExecutionPlan } from "./execution-plan.ts";
import { createExecutionEvidence, evaluationEvidenceForReply, readExecutionEvidence } from "./execution-evidence.ts";
import { readRatings, saveRating } from "./routing-modes.ts";
import { normalizeWorkspace } from "./workspace.ts";

test("AA016/104/108 real SSE receipt survives workspace reload and joins subjective rating to exact execution", async () => {
  const plan = modelExecutionPlan("synthesis", ["grok"], ["gemini", "openai"]);
  const helperReceipts = [
    { id: "gemini", status: "succeeded", contributed: true, model: "gemini-reported", requestedModel: "gemini-selected", requestId: "helper-1", usage: { prompt_tokens: 40, completion_tokens: 12 }, durationMs: 50, error: null },
    { id: "openai", status: "failed", contributed: false, model: null, requestedModel: "configured-model", requestId: null, usage: null, durationMs: 25, error: "Fixture unavailable" },
  ];
  const done = { text: "Fixture answer", provider: "grok", model: "reported-primary", requestedModel: "requested-primary", requestId: "primary-request", resourceOperationId: "resource-operation", usage: { prompt_tokens: 10, completion_tokens: 0 }, usedIds: [], executionPlan: plan, helperReceipts };
  const result = await consumeMindTurn({ url: "/fixture", body: {}, headers: {}, signal: new AbortController().signal, onDelta() {}, fetchImpl: async () => new Response(`event: done\ndata: ${JSON.stringify(done)}\n\n`, { headers: { "content-type": "text/event-stream" } }) });
  assert(result.ok);
  assert.deepEqual(result.executionPlan, plan);
  assert.equal(result.resourceOperationId, "resource-operation");
  assert.equal(result.helperReceipts?.[1].status, "failed");
  const evidence = createExecutionEvidence("turn-fixture", result);
  const workspace = normalizeWorkspace({ chats: [{ id: "chat", title: "Fixture", messages: [{ id: "reply", role: "assistant", content: result.text, at: "2026-01-01T00:00:00Z", executionId: "turn-fixture", executionEvidence: evidence }] }], usage: [{ id: "usage", executionId: "turn-fixture", chatId: "chat", model: result.model, promptTokens: 10, completionTokens: 0 }] });
  const reply = workspace.chats[0].messages[0];
  assert.deepEqual(reply.executionEvidence, evidence);
  assert.equal(workspace.usage[0].executionId, "turn-fixture");
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
  saveRating(storage, { messageId: reply.id, score: 5, model: result.requestedModel ?? null, reportedModel: result.model, executionId: reply.executionId, executionEvidence: evidence, taskCategory: "conversation", evidenceType: "subjective", mode: null, at: "2026-01-01T00:00:01Z" }, "owner");
  const [rating] = readRatings(storage, "owner");
  const joined = evaluationEvidenceForReply(rating, [reply]); assert.equal(joined.status, "matched");
  if (joined.status === "matched") {
    assert.equal(joined.evidence.usage?.completion_tokens, 0);
    assert.equal(joined.evidence.helpers[1].usage, null);
    assert.equal(joined.evidence.objectiveCompletion, "unverified");
    assert.equal(joined.evidence.factualAccuracy, "unverified");
    assert.equal(joined.evidence.billingEvidence, "unverified");
  }
  assert.equal(evaluationEvidenceForReply({ ...rating, executionId: "different" }, [reply]).status, "unavailable");
  assert.equal(readRatings(storage, "other").length, 0);
});

test("AA108 corrupt or legacy evidence cannot become verified model or budget evidence", () => {
  const evidence = createExecutionEvidence("legacy", { model: "model unknown", usage: { prompt_tokens: -1, completion_tokens: "5" }, executionPlan: { kind: "synthesis" } });
  assert.equal(evidence.reportedModel, null); assert.equal(evidence.identityEvidence, "unverified"); assert.equal(evidence.usage, null); assert.equal(evidence.plan, null);
  assert.equal(readExecutionEvidence(evidence, "different"), undefined);
  assert.equal(evaluationEvidenceForReply({ messageId: "legacy" }, [{ id: "legacy" }]).status, "unavailable");
  const forged = readExecutionEvidence({ ...evidence, factualAccuracy: "verified", objectiveCompletion: "verified" });
  assert.equal(forged?.factualAccuracy, "unverified"); assert.equal(forged?.objectiveCompletion, "unverified");
});

test("AA016 primary HTTP and SSE failures keep completed helper receipts without saving an assistant success", async () => {
  const receipt = { id: "gemini", status: "succeeded", contributed: true, model: "reported-helper", requestedModel: "selected-helper", requestId: "helper-request", usage: { prompt_tokens: 1, completion_tokens: 2 }, durationMs: 10, error: null };
  for (const response of [Response.json({ error: "Primary rejected", helperReceipts: [receipt] }, { status: 502 }), new Response(`event: error\ndata: ${JSON.stringify({ error: "Primary stream failed", helperReceipts: [receipt] })}\n\n`, { headers: { "content-type": "text/event-stream" } })]) {
    const result = await consumeMindTurn({ url: "/fixture", body: {}, headers: {}, signal: new AbortController().signal, onDelta() {}, fetchImpl: async () => response });
    assert.equal(result.ok, false);
    assert.deepEqual(result.helperReceipts, [receipt]);
  }
});
