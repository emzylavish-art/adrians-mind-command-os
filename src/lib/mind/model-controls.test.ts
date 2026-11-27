import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModelControls, resolveModelTier, routeAutoTier } from "./model-tiers.ts";

test("explicit continuation retains its prior tier without raising unrelated requests", () => {
  assert.equal(routeAutoTier("next analysis", "Heavy").tier, "Heavy");
  assert.equal(routeAutoTier("continue", "Build").tier, "Build");
  assert.equal(routeAutoTier("hello", "Heavy").tier, "Fast");
});
test("answer and reasoning budgets are independent and defaults stay unchanged", () => {
  assert.equal(resolveModelTier("Expert", "hello").params.max_tokens, 500);
  const chosen = resolveModelTier("Expert", "hello", {}, { controls: { answerTokens: 4096, reasoning: "none" } });
  assert.equal(chosen.params.max_tokens, 4096); assert.equal(chosen.params.reasoning_effort, undefined);
  assert.equal(resolveModelTier("Heavy", "hello", { MIND_MODEL_HEAVY: "unverified-model" }).params.reasoning_effort, undefined);
  assert.equal(parseModelControls({ answerTokens: 999999 }).ok, false);
  assert.equal(parseModelControls({ reasoning: "unbounded" }).ok, false);
});
