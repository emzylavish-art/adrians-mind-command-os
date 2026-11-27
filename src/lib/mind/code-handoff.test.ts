import assert from "node:assert/strict";
import test from "node:test";
import { codeDraftKey, MAX_CODE_HANDOFF_CHARS, stageCodeHandoff, takeTemporaryCodeHandoff } from "./code-handoff.ts";

const memory = () => { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };
test("a complete Build result above 4,000 characters reaches only its exact account and thread", () => {
  const storage = memory(); const text = "  source start\n" + "🧩line\n".repeat(3000) + "\ncomplete tail  ";
  assert.deepEqual(stageCodeHandoff(storage, "owner-a", "thread-a", text, false), { ok: true, characters: text.length });
  assert.equal(JSON.parse(storage.getItem(codeDraftKey("owner-a", "thread-a", false))!), text);
  assert.equal(storage.getItem(codeDraftKey("owner-b", "thread-a", false)), null);
  assert.equal(storage.getItem(codeDraftKey("owner-a", "thread-b", false)), null);
  assert.equal(storage.getItem("adrian-human-draft"), null);
});
test("temporary handoffs stay in memory and cannot be consumed by a different account", () => {
  const storage = memory(); stageCodeHandoff(storage, "owner-a", "private", "private complete fixture", true);
  assert.equal(storage.values.size, 0); assert.equal(takeTemporaryCodeHandoff("owner-b", "private"), undefined);
  assert.equal(takeTemporaryCodeHandoff("owner-a", "private"), "private complete fixture");
  assert.equal(takeTemporaryCodeHandoff("owner-a", "private"), undefined);
});
test("oversize, quota failures and failed readback are reported without a false delivery receipt", () => {
  const storage = memory();
  assert.equal(stageCodeHandoff(storage, "a", "t", "x".repeat(MAX_CODE_HANDOFF_CHARS + 1), false).ok, false);
  assert.equal(storage.values.size, 0);
  for (const broken of [{ getItem: () => null, setItem: () => { throw new Error("quota"); } }, { getItem: () => null, setItem: () => {} }]) assert.equal(stageCodeHandoff(broken, "a", "t", "complete fixture", false).ok, false);
});
