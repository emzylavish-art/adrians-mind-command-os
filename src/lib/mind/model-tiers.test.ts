import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MODEL_TIERS,
  allowedModelIds,
  buildProviderModelFields,
  parseModelTierEnv,
  resolveModelTier,
  routeAutoTier,
} from "./model-tiers.ts";

describe("model tier mapping", () => {
  it("exposes the five picker modes", () => {
    assert.deepEqual([...MODEL_TIERS], ["Auto", "Fast", "Expert", "Heavy", "Build"]);
  });

  it("maps each concrete mode to a distinct default model id", () => {
    const models = parseModelTierEnv({});
    const ids = [models.Fast, models.Expert, models.Heavy, models.Build];
    assert.equal(new Set(ids).size, 4);
    assert.equal(models.Fast, "grok-4.20-0309-non-reasoning");
    assert.equal(models.Expert, "grok-4.5");
    assert.equal(models.Heavy, "grok-4.7");
    assert.equal(models.Build, "grok-build-0.1");
  });

  it("honors env overrides for each concrete mode", () => {
    const models = parseModelTierEnv({
      MIND_MODEL_FAST: "fast-custom",
      MIND_MODEL_EXPERT: "expert-custom",
      MIND_MODEL_HEAVY: "heavy-custom",
      MIND_MODEL_BUILD: "build-custom",
    });
    assert.deepEqual(models, {
      Fast: "fast-custom",
      Expert: "expert-custom",
      Heavy: "heavy-custom",
      Build: "build-custom",
    });
  });

  it("puts a different model id in the outgoing provider fields for each concrete mode", () => {
    const seen = new Set<string>();
    for (const tier of ["Fast", "Expert", "Heavy", "Build"] as const) {
      const resolved = resolveModelTier(tier, "hello", {});
      const body = buildProviderModelFields(resolved);
      assert.equal(body.model, resolved.model);
      assert.equal(typeof body.model, "string");
      seen.add(String(body.model));
      if (tier === "Expert" || tier === "Heavy") {
        assert.ok(body.reasoning_effort);
      }
      if (tier === "Fast" || tier === "Build") {
        assert.equal(body.reasoning_effort, undefined);
      }
    }
    assert.equal(seen.size, 4);
  });

  it("defaults unknown/missing selection to Auto then routes", () => {
    const resolved = resolveModelTier(undefined, "hi", {});
    assert.equal(resolved.selected, "Auto");
    assert.equal(resolved.resolved, "Fast");
    assert.equal(resolved.model, "grok-4.20-0309-non-reasoning");
  });
});

describe("Auto routing", () => {
  it("routes short prompts to Fast", () => {
    assert.equal(routeAutoTier("Hi").tier, "Fast");
    assert.equal(routeAutoTier("What time is it?").tier, "Fast");
  });

  it("routes code-shaped prompts to Build", () => {
    assert.equal(routeAutoTier("Please refactor this TypeScript function:\n```ts\nexport const x = 1\n```").tier, "Build");
    assert.equal(routeAutoTier("Fix the stack trace in app.py").tier, "Build");
  });

  it("routes long or deep-reasoning prompts to Heavy", () => {
    assert.equal(routeAutoTier("Please prove this rigorously with a formal proof of correctness.").tier, "Heavy");
    assert.equal(routeAutoTier("x".repeat(2000)).tier, "Heavy");
  });

  it("routes medium analytical prompts to Expert", () => {
    assert.equal(routeAutoTier("Explain how DNS resolution works in browsers and resolvers.").tier, "Expert");
  });

  it("resolveModelTier Auto yields the routed concrete model id", () => {
    const code = resolveModelTier("Auto", "Write a unit test for this JavaScript module", {});
    assert.equal(code.selected, "Auto");
    assert.equal(code.resolved, "Build");
    assert.equal(code.model, "grok-build-0.1");
    const simple = resolveModelTier("Auto", "Thanks", {});
    assert.equal(simple.resolved, "Fast");
    assert.equal(simple.model, "grok-4.20-0309-non-reasoning");
  });

  it("allowedModelIds includes defaults and overrides", () => {
    const base = allowedModelIds({});
    assert.ok(base.has("grok-4.5"));
    assert.ok(base.has("grok-4.7"));
    const custom = allowedModelIds({ MIND_MODEL_EXPERT: "custom-expert" });
    assert.ok(custom.has("custom-expert"));
    assert.equal(custom.has("grok-4.5"), false);
  });
});


describe("Auto heavyHints narrowness", () => {
  it("keeps everyday tradeoffs / architecture prompts on Expert", () => {
    assert.equal(routeAutoTier("Please analyze the design tradeoffs for this API.").tier, "Expert");
    assert.equal(routeAutoTier("Explain the architecture of a pier booking flow.").tier, "Expert");
    assert.equal(routeAutoTier("Compare the trade-offs of caching strategies briefly.").tier, "Expert");
  });

  it("still routes real deep-reasoning or long prompts to Heavy", () => {
    assert.equal(routeAutoTier("Please prove this rigorously with a formal proof of correctness.").tier, "Heavy");
    assert.equal(routeAutoTier("Provide a deep analysis with multi-step reasoning.").tier, "Heavy");
    assert.equal(routeAutoTier("x".repeat(1800)).tier, "Heavy");
  });
});
