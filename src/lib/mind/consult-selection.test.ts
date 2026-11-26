import assert from "node:assert/strict";
import { test } from "node:test";
import { collectConsultHelp, planModelConsult } from "./model-consult.ts";
const modules = ["primary", "helper-a", "helper-b", "new-key"].map((id) => ({ id, label: id, connected: true }));

test("connecting another key never authorizes it to receive the prompt", () => {
  const defaultPlan = planModelConsult({ orchestrator: "primary", modules, question: "Private prompt" });
  assert.ok(defaultPlan.ok); assert.deepEqual(defaultPlan.plan.helpers, []);
  const selected = planModelConsult({ orchestrator: "primary", modules, selectedHelpers: ["helper-a"], question: "Private prompt" });
  assert.ok(selected.ok); assert.deepEqual(selected.plan.helpers.map((helper) => helper.id), ["helper-a"]);
  assert.equal(planModelConsult({ orchestrator: "primary", modules, selectedHelpers: ["disconnected"], question: "Private prompt" }).ok, false);
});

test("bounded parallel calls retain independent failures and explicit excerpt metadata", async () => {
  const plan = planModelConsult({ orchestrator: "primary", modules, selectedHelpers: ["helper-a", "helper-b", "new-key"], question: "Review the proposal" });
  assert.ok(plan.ok);
  let active = 0, max = 0;
  const evidence = await collectConsultHelp(plan.plan, async (id) => {
    active++; max = Math.max(max, active); await new Promise((resolve) => setTimeout(resolve, 2)); active--;
    if (id === "helper-b") throw new Error("secret must not leak");
    return { ok: true, text: "x".repeat(13000) };
  });
  assert.equal(max, 2); assert.equal(evidence.length, 3); assert.equal(evidence[0]?.truncated, true); assert.equal(evidence[0]?.originalCharacters, 13000);
  assert.equal(evidence[1]?.ok, false); assert.equal(JSON.stringify(evidence).includes("secret must not leak"), false);
  assert.notEqual(plan.plan.helpers[0]?.request, plan.plan.helpers[1]?.request);
});
