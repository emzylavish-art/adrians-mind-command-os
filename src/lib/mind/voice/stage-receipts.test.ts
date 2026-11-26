import assert from "node:assert/strict";
import { test } from "node:test";
import { createVoiceStagesReceipt, mergeVoiceStagesReceipt, normalizeVoiceStagesReceipt, recordVoicePlayback, recordVoiceStage, storeVoiceReceipt, readVoiceReceipts } from "./stage-receipts.ts";
const at = "2026-01-01T00:00:00Z";
test("selected speech providers stay distinct from returned attribution and text-only answers", () => {
  let receipt = createVoiceStagesReceipt({ operationId: "fixture-1", inputProvider: "custom:input", answerProvider: "gemini", outputProvider: "custom:output" }, at);
  assert.equal(receipt.input.actualProvider, null); assert.equal(receipt.answer.actualProvider, null);
  receipt = recordVoiceStage(receipt, "input", { ok: true, provider: "OpenAI", requestId: "transcribe-fixture" }, at);
  receipt = recordVoiceStage(receipt, "answer", { ok: true, provider: "Gemini", model: "reported-text-model" }, at);
  receipt = recordVoiceStage(receipt, "output", { ok: true, provider: "xAI", model: "reported-speech-model" }, at);
  receipt = recordVoicePlayback(receipt, "played", at);
  assert.equal(receipt.input.selectedProvider, "custom:input"); assert.equal(receipt.input.actualProvider, "OpenAI");
  assert.equal(receipt.answer.actualModel, "reported-text-model"); assert.equal(receipt.output.actualProvider, "xAI"); assert.equal(receipt.verified, false);
  assert.deepEqual(normalizeVoiceStagesReceipt(JSON.parse(JSON.stringify(receipt))), receipt);
});
test("cached playback and missing provider attribution never fabricate a new provider call", () => {
  let receipt = createVoiceStagesReceipt({ operationId: "fixture-2", outputProvider: "openai", readAloud: true }, at);
  receipt = recordVoiceStage(receipt, "output", { ok: true }, at);
  receipt = recordVoicePlayback(receipt, "failed", at);
  receipt = recordVoicePlayback(receipt, "played", "2026-01-01T00:00:01Z");
  assert.equal(receipt.input.state, "not_requested"); assert.equal(receipt.answer.attempts, 0);
  assert.equal(receipt.output.attempts, 1); assert.equal(receipt.output.actualProvider, null); assert.equal(receipt.output.selectedProvider, "openai");
});
test("independent stage updates merge without regressing evidence or crossing operation identity", () => {
  const initial = createVoiceStagesReceipt({ operationId: "fixture-3", inputProvider: "openai", answerProvider: "gemini", outputProvider: "xai" }, at);
  const input = recordVoiceStage(initial, "input", { ok: true, provider: "OpenAI" }, "2026-01-01T00:00:02Z");
  const answer = recordVoiceStage(initial, "answer", { ok: false }, "2026-01-01T00:00:03Z");
  const combined = mergeVoiceStagesReceipt(input, answer);
  assert.equal(combined.input.actualProvider, "OpenAI"); assert.equal(combined.answer.state, "failed"); assert.equal(combined.output.state, "pending");
  assert.deepEqual(mergeVoiceStagesReceipt(combined, initial), combined);
  assert.deepEqual(mergeVoiceStagesReceipt(combined, { ...initial, operationId: "different-operation" }), combined);
  assert.equal(normalizeVoiceStagesReceipt({ ...combined, verified: true })?.verified, false);
});


test("saved voice receipts survive workspace roundtrip and account-owned metadata is bounded", async () => {
  const { emptyWorkspace, normalizeWorkspace } = await import("../workspace.ts");
  const { accountPreferences } = await import("../account-preferences.ts");
  const values = new Map<string, string>();
  const raw = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const owner = accountPreferences(raw, "owner-a");
  for (let i = 0; i < 25; i++) storeVoiceReceipt(owner, createVoiceStagesReceipt({ operationId: `operation-${i}`, outputProvider: "xai", readAloud: true }, at));
  assert.equal(readVoiceReceipts(owner).length, 20);
  assert.equal(readVoiceReceipts(accountPreferences(raw, "owner-b")).length, 0);
  let receipt = createVoiceStagesReceipt({ operationId: "saved-answer", inputProvider: "openai", answerProvider: "gemini", outputProvider: "xai" }, at);
  receipt = recordVoiceStage(receipt, "answer", { ok: true, provider: "Gemini", model: "fixture-answer-model" }, at);
  const ws = emptyWorkspace();
  ws.chats = [{ id: "voice-chat", title: "Voice", messages: [{ id: "answer", role: "assistant", at, content: "Fixture answer", voiceStages: receipt }] }] as typeof ws.chats;
  const restored = normalizeWorkspace(JSON.parse(JSON.stringify(ws)));
  assert.deepEqual(restored.chats[0]?.messages[0]?.voiceStages, receipt);
  storeVoiceReceipt(owner, receipt); storeVoiceReceipt(owner, recordVoicePlayback(receipt, "played", at));
  assert.equal(readVoiceReceipts(owner).filter((entry) => entry.operationId === receipt.operationId).length, 1);
});
