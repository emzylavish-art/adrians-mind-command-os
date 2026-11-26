import test from "node:test";
import assert from "node:assert/strict";
import { mediaPayloadHash, memoryMediaOperations, runMediaOnce, type MediaOperation } from "./operations.server.ts";
const operation = (): MediaOperation => ({ id: "fixture-operation", kind: "video", payloadHash: mediaPayloadHash({ prompt: "fake" }), chatId: "chat-a", state: "dispatching", result: null });
test("accepted video survives reload without a second generation and other owners cannot read it", async () => {
  const store = memoryMediaOperations(); let calls = 0;
  const dispatch = async () => { calls++; return { ok: true, requestId: "fake-provider-id", state: "pending" }; };
  await runMediaOnce(store, "a", operation(), dispatch);
  const recovered = await runMediaOnce(store, "a", operation(), dispatch);
  assert.equal(calls, 1); assert.equal(recovered.recovered, true);
  assert.equal(await store.get("b", "fixture-operation"), null);
  assert.equal((await store.list("a"))[0]?.chatId, "chat-a");
});
test("simultaneous duplicates, uncertain responses and changed prompts never repeat the provider call", async () => {
  const store = memoryMediaOperations(); let calls = 0;
  const dispatch = async () => { calls++; throw new Error("lost response"); };
  await Promise.all([runMediaOnce(store, "a", operation(), dispatch), runMediaOnce(store, "a", operation(), dispatch)]);
  assert.equal(calls, 1);
  const conflict = await runMediaOnce(store, "a", { ...operation(), payloadHash: "changed" }, dispatch);
  assert.equal(conflict.code, "operation_conflict"); assert.equal(calls, 1);
});

test("temporary image results are returned once without retaining pixels or repeating generation", async () => {
  const store = memoryMediaOperations(); let calls = 0;
  const op = { ...operation(), kind: "image" as const, chatId: null, retainResult: false };
  const dispatch = async () => { calls++; return { ok: true, images: [{ dataUrl: "data:image/png;base64,c3ludGhldGlj" }] }; };
  const first = await runMediaOnce(store, "a", op, dispatch);
  assert.equal(first.ok, true);
  assert.ok(Array.isArray(first.images));
  const saved = await store.get("a", op.id);
  assert.equal(saved?.state, "completed");
  assert.equal(saved?.chatId, null);
  assert.equal(JSON.stringify(saved).includes("data:image"), false);
  const retried = await runMediaOnce(store, "a", op, dispatch);
  assert.equal(retried.code, "temporary_result_not_retained");
  assert.equal(calls, 1);
});

test("temporary videos retain only the accepted polling handle; policy denial is not uncertain spend", async () => {
  const store = memoryMediaOperations();
  const op = { ...operation(), retainResult: false, chatId: null };
  await runMediaOnce(store, "a", op, async () => ({ ok: true, state: "pending", requestId: "synthetic-provider", prompt: "must not be retained" }));
  const saved = await store.get("a", op.id);
  assert.equal(saved?.result?.requestId, "synthetic-provider");
  assert.equal(saved?.result?.prompt, undefined);
  const denied = await runMediaOnce(store, "b", operation(), async () => ({ ok: false, code: "resource_policy", dispatched: false, status: 403 }));
  assert.equal((denied.receipt as { cost: string }).cost, "not-dispatched");
  assert.equal((await store.get("b", op.id))?.state, "failed");
});
