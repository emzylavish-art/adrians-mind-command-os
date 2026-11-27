import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { completeLegacyModelReply, type LegacyPreparedTurn, type LegacyTurnDependencies } from "./legacy-turn.server.ts";
import type { MonetaryDispatchContext, MonetarySettlement } from "./financial-policy.ts";

function prepared(overrides: Partial<LegacyPreparedTurn> = {}): LegacyPreparedTurn {
  return {
    assembled: { messages: [{ role: "system", content: "Synthetic system instructions." }, { role: "user", content: "A synthetic question." }], usedIds: [] },
    memory: "off", model: "grok-fixture", userId: "owner-a", operationId: "legacy-op-1", taskId: "task-1", projectId: "project-1",
    modelTier: { selected: "Fast", resolved: "Fast", model: "grok-fixture", reason: "Owner selected fixture.", params: { temperature: 0.3, max_tokens: 400 } },
    ...overrides,
  };
}

function fixture(overrides: LegacyTurnDependencies = {}) {
  const contexts: MonetaryDispatchContext[] = [];
  const receipts: MonetarySettlement[] = [];
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const order: string[] = [];
  const deps: LegacyTurnDependencies = {
    halt: async (owner) => { assert.equal(owner, "owner-a"); order.push("halt"); return "off"; },
    memory: async (owner) => { assert.equal(owner, "owner-a"); order.push("memory"); return { ok: true }; },
    catalogue: async (owner, provider, model, requirements) => {
      assert.equal(owner, "owner-a"); assert.equal(provider, "grok"); assert.ok(model);
      assert.equal(requirements?.outputTokens, 400); order.push("catalogue");
      return { ok: true, availability: "unverified", verifiedInference: false };
    },
    credential: () => { order.push("credential"); return { ok: true, key: "synthetic-key" }; },
    finance: {
      reserve: async (owner, _sql, _now, context) => {
        assert.equal(owner, "owner-a"); assert.ok(context); contexts.push(context); order.push("reserve");
        return { ok: true, reservationId: "reservation-1" };
      },
      settle: async (owner, id, receipt) => {
        assert.equal(owner, "owner-a"); assert.equal(id, "reservation-1"); receipts.push(receipt); order.push("settle"); return { ok: true };
      },
    },
    fetchImpl: async (url, init) => {
      order.push("fetch"); calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json({ choices: [{ message: { content: "Fixture answer." } }], model: "grok-returned-fixture", usage: { prompt_tokens: 12, completion_tokens: 3 } }, { headers: { "x-request-id": "request-1" } });
    },
    ...overrides,
  };
  return { deps, contexts, receipts, calls, order };
}

test("legacy budget denial returns the exact approval and retry identity without sending or settling", async () => {
  const f = fixture();
  f.deps.finance!.reserve = async (owner, _sql, _now, context) => {
    assert.equal(owner, "owner-a"); assert.ok(context); f.contexts.push(context);
    return { ok: false, error: "Review the exact request.", status: 409, approvalId: "approval-1" };
  };
  const result = await completeLegacyModelReply(prepared(), f.deps);
  assert.deepEqual(result, { ok: false, error: "Review the exact request.", dispatched: false, operationId: "legacy-op-1", approvalId: "approval-1" });
  assert.equal(f.calls.length, 0); assert.equal(f.receipts.length, 0);
  const context = f.contexts[0];
  assert.equal(context.operationId, "legacy-op-1"); assert.equal(context.taskId, "task-1"); assert.equal(context.projectId, "project-1");
  assert.equal(context.provider, "xai"); assert.equal(context.model, "grok-fixture"); assert.equal(context.textOnly, true);
  assert.match(context.requestHash!, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(context).includes("synthetic question"), false); assert.equal(JSON.stringify(context).includes("synthetic-key"), false);
});

test("legacy dispatch rechecks stop, saved-memory policy, catalogue and credentials before a reservation", async () => {
  const cases: LegacyTurnDependencies[] = [
    { halt: async () => "on" },
    { halt: async () => "unknown" },
    { memory: async (_owner, usedMemory) => { assert.equal(usedMemory, true); return { ok: false, error: "Memory suspended after preparation." }; } },
    { catalogue: async () => ({ ok: false, availability: "unavailable", verifiedInference: false, error: "Exact model removed after preparation." }) },
    { credential: () => ({ ok: false, error: "Credential unavailable." }) },
  ];
  for (const override of cases) {
    const f = fixture(override);
    const result = await completeLegacyModelReply(prepared({ usedSavedMemory: true }), f.deps);
    assert.equal(result.ok, false); assert.equal("dispatched" in result && result.dispatched, false);
    assert.equal(f.contexts.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.receipts.length, 0);
  }
});

test("successful legacy reply binds the exact outgoing model, messages and parameters and does not invent a charge", async () => {
  const f = fixture();
  const input = prepared();
  const result = await completeLegacyModelReply(input, f.deps);
  assert.equal(result.ok, true); if (!result.ok) throw new Error("Expected fixture reply.");
  assert.equal(result.operationId, "legacy-op-1"); assert.equal(result.text, "Fixture answer."); assert.equal(result.model, "grok-returned-fixture");
  assert.equal(result.requestId, "request-1"); assert.deepEqual(result.usage, { prompt_tokens: 12, completion_tokens: 3 });
  assert.deepEqual(f.calls[0], { url: "https://api.x.ai/v1/chat/completions", body: {
    model: "grok-fixture", messages: input.assembled.messages, max_tokens: 400, temperature: 0.3, stream: true, stream_options: { include_usage: true },
  } });
  assert.equal(f.contexts[0].requestHash, createHash("sha256").update(JSON.stringify(f.calls[0].body)).digest("hex"));
  assert.deepEqual(f.order, ["halt", "memory", "catalogue", "credential", "reserve", "fetch", "settle"]);
  assert.deepEqual(f.receipts, [{ outcome: "completed" }]);
  assert.equal("actualCostMicros" in f.receipts[0], false); assert.equal("actualCostMicros" in result, false);
});

test("legacy empty, network and provider errors retain unknown cost and never claim a replayable no-dispatch result", async () => {
  const fetchers: typeof fetch[] = [
    async () => { throw new TypeError("Synthetic network interruption."); },
    async () => Response.json({ choices: [] }),
    async () => Response.json({ error: "Synthetic failure." }, { status: 503 }),
  ];
  for (const fetchImpl of fetchers) {
    let calls = 0;
    const f = fixture({ fetchImpl: async (...args) => { calls++; return fetchImpl(...args); } });
    const result = await completeLegacyModelReply(prepared(), f.deps);
    assert.equal(result.ok, false); assert.equal("dispatched" in result, false); assert.equal(calls, 1);
    assert.equal(result.operationId, "legacy-op-1"); assert.deepEqual(f.receipts, [{ outcome: "unknown" }]);
  }
});

test("changing legacy arguments preserves an explicit operation identity but invalidates its immutable fingerprint", async () => {
  const f = fixture({ catalogue: async () => ({ ok: true, availability: "unverified", verifiedInference: false }) });
  const original = prepared();
  const changedModel = { ...original, model: "different-model" };
  const changedMessages = { ...original, assembled: { ...original.assembled, messages: [{ role: "user" as const, content: "Changed synthetic question." }] } };
  const changedParams = { ...original, modelTier: { ...original.modelTier, params: { ...original.modelTier.params, max_tokens: 800 } } };
  for (const input of [original, changedModel, changedMessages, changedParams]) await completeLegacyModelReply(input, f.deps);
  assert.equal(new Set(f.contexts.map(context => context.requestHash)).size, 4);
  assert.equal(f.contexts.every(context => context.operationId === "legacy-op-1" && context.taskId === "task-1"), true);
});

test("legacy image and saved-note context use their actual dispatch capability and privacy requirements", async () => {
  const f = fixture({
    memory: async (_owner, usedMemory) => { assert.equal(usedMemory, true); return { ok: true }; },
    catalogue: async (_owner, _provider, _model, requirements) => { assert.deepEqual(requirements, { images: 1, outputTokens: 400 }); return { ok: true, availability: "unverified", verifiedInference: false }; },
  });
  await completeLegacyModelReply(prepared({ assembled: { usedIds: ["saved-note-1"], messages: [{ role: "user", content: [{ type: "text", text: "Describe fixture." }, { type: "image_url", image_url: { url: "data:image/png;base64,Zml4dHVyZQ==" } }] }] } }), f.deps);
  assert.equal(f.contexts[0].textOnly, false);
});

test("authenticated legacy sendTurn is mounted to the guarded completion and carries retry metadata", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  const turn = readFileSync(new URL("./turn.server.ts", import.meta.url), "utf8");
  const mount = server.slice(server.indexOf("export const sendTurn ="), server.indexOf("export const setExecutionHalt ="));
  assert.match(mount, /middleware\(\[authMiddleware\]\)/);
  for (const field of ["operationId", "taskId", "projectId"]) {
    assert.match(mount, new RegExp(`${field}\\?: string`));
    assert.match(turn, new RegExp(`${field}: data\\.${field}`));
  }
  assert.match(mount, /prepareMindTurn\(context\.userId, data\)/); assert.match(mount, /completeModelReply\(prepared\)/);
  const completion = turn.slice(turn.indexOf("export async function completeModelReply"), turn.indexOf("\nfunction json("));
  assert.match(completion, /return completeLegacyModelReply\(prepared, deps\)/); assert.equal(/fetch\(/.test(completion), false);
});
