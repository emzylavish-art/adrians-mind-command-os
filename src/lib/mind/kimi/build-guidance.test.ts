import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareBuildTask } from "./build-guidance.ts";

test("Build receives only activated build-scoped guidance with honest application receipts", () => {
  const result = prepareBuildTask("Implement keyboard navigation", [
    { skillId: "draft:draft-1:v2", name: "Accessibility", version: 2, body: "Check focus order.", scope: "build" },
    { skillId: "draft:draft-2:v2", name: "Conversation only", version: 2, body: "Do not send to Build.", scope: "chat" },
  ]);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.match(result.prompt, /Check focus order/); assert.match(result.prompt, /do not change authorization/i); assert.doesNotMatch(result.prompt, /Do not send to Build/);
  assert.deepEqual(result.skillReceipts.map(item => [item.skillId, item.stage]), [["draft:draft-1:v2", "instructions_applied"], ["draft:draft-2:v2", "omitted_scope"]]);
  assert.ok(result.skillReceipts.every(item => item.verified === false && item.toolsExecuted.length === 0));
});
test("oversized Build task is rejected without losing its ending, empty guidance claims no application", () => {
  assert.equal(prepareBuildTask("x".repeat(8000) + "TRAILING REQUIREMENT", []).ok, false);
  assert.deepEqual(prepareBuildTask("Task", []), { ok: true, prompt: "Task", skillReceipts: [] });
});
