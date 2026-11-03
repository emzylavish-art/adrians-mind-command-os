import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MODEL_TIERS,
  allowedModelIds,
  buildProviderModelFields,
  modelTierCatalog,
  modelTierEnvIssues,
  parseModelTierEnv,
  chipLabelForTier,
  isConcreteModelTier,
  resolveModelTier,
  routeAutoTier,
} from "./model-tiers.ts";

describe("model tier mapping", () => {
  it("exposes the six picker modes including Orchestrator", () => {
    assert.deepEqual([...MODEL_TIERS], ["Auto", "Fast", "Expert", "Heavy", "Build", "Orchestrator"]);
  });

  it("maps each concrete mode to a default model id", () => {
    const models = parseModelTierEnv({});
    assert.equal(models.Fast, "grok-4.20-0309-non-reasoning");
    assert.equal(models.Expert, "grok-4.5");
    assert.equal(models.Heavy, "grok-4.7");
    assert.equal(models.Build, "grok-build-0.1");
    assert.equal(models.Orchestrator, "grok-4.7");
  });

  it("honors env overrides for each concrete mode", () => {
    const models = parseModelTierEnv({
      MIND_MODEL_FAST: "fast-custom",
      MIND_MODEL_EXPERT: "expert-custom",
      MIND_MODEL_HEAVY: "heavy-custom",
      MIND_MODEL_BUILD: "build-custom",
      MIND_MODEL_ORCHESTRATOR: "orch-custom",
    });
    assert.deepEqual(models, {
      Fast: "fast-custom",
      Expert: "expert-custom",
      Heavy: "heavy-custom",
      Build: "build-custom",
      Orchestrator: "orch-custom",
    });
  });

  it("puts a different model id in the outgoing provider fields for each concrete mode", () => {
    const seen = new Set<string>();
    for (const tier of ["Fast", "Expert", "Heavy", "Build", "Orchestrator"] as const) {
      const resolved = resolveModelTier(tier, "hello", {});
      const body = buildProviderModelFields(resolved);
      assert.equal(body.model, resolved.model);
      assert.equal(typeof body.model, "string");
      seen.add(`${tier}:${body.model}`);
      if (tier === "Expert" || tier === "Heavy" || tier === "Orchestrator") {
        assert.ok(body.reasoning_effort);
      }
      if (tier === "Fast" || tier === "Build") {
        assert.equal(body.reasoning_effort, undefined);
      }
    }
    assert.equal(seen.size, 5);
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


describe("modelTierEnvIssues", () => {
  const SECRET = "xai-SUPERSECRET-0123456789abcdef";

  it("rejects malformed ids and falls back to the default with an explicit issue", () => {
    const env = { MIND_MODEL_FAST: "grok 4\nInjected: yes", MIND_MODEL_BUILD: "x".repeat(300) };
    const models = parseModelTierEnv(env);
    assert.equal(models.Fast, "grok-4.20-0309-non-reasoning");
    assert.equal(models.Build, "grok-build-0.1");
    const issues = modelTierEnvIssues(env);
    assert.equal(issues.length, 2);
    assert.ok(issues.some((issue) => issue.includes("MIND_MODEL_FAST")));
    assert.ok(issues.some((issue) => issue.includes("MIND_MODEL_BUILD")));
    assert.equal(issues.join(" ").includes("Injected"), false);
  });

  it("never exposes an API key pasted into a model env var", () => {
    const env = { MIND_MODEL_HEAVY: SECRET };
    assert.equal(parseModelTierEnv(env).Heavy, "grok-4.7");
    assert.equal(JSON.stringify(modelTierCatalog(env)).includes(SECRET), false);
    assert.equal(allowedModelIds(env).has(SECRET), false);
    assert.equal(resolveModelTier("Heavy", "x", env).model, "grok-4.7");
    const issues = modelTierEnvIssues(env);
    assert.equal(issues.length, 1);
    assert.equal(issues.join(" ").includes(SECRET), false);
    assert.equal(issues.join(" ").includes("SUPERSECRET"), false);
  });

  it("rejects empty / whitespace-only overrides without echoing them", () => {
    const env = { MIND_MODEL_EXPERT: "   ", MIND_MODEL_FAST: "" };
    assert.equal(parseModelTierEnv(env).Expert, "grok-4.5");
    assert.equal(parseModelTierEnv(env).Fast, "grok-4.20-0309-non-reasoning");
    const issues = modelTierEnvIssues(env);
    assert.ok(issues.some((issue) => issue.includes("MIND_MODEL_EXPERT")));
  });

  it("keeps valid overrides (dots, dashes, colons, slashes)", () => {
    const env = { MIND_MODEL_EXPERT: "grok-4.5-0901", MIND_MODEL_HEAVY: "xai/grok-4.7:latest" };
    assert.equal(parseModelTierEnv(env).Expert, "grok-4.5-0901");
    assert.equal(parseModelTierEnv(env).Heavy, "xai/grok-4.7:latest");
    assert.deepEqual(modelTierEnvIssues(env), []);
  });
});


describe("Orchestrator tier", () => {
  it("resolves to grok-4.7 with high reasoning_effort", () => {
    const resolved = resolveModelTier("Orchestrator", "coordinate the tools", {});
    assert.equal(resolved.selected, "Orchestrator");
    assert.equal(resolved.resolved, "Orchestrator");
    assert.equal(resolved.model, "grok-4.7");
    assert.equal(resolved.params.reasoning_effort, "high");
    const body = buildProviderModelFields(resolved);
    assert.equal(body.model, "grok-4.7");
    assert.equal(body.reasoning_effort, "high");
  });

  it("honors MIND_MODEL_ORCHESTRATOR override", () => {
    const env = { MIND_MODEL_ORCHESTRATOR: "orch-override-model" };
    assert.equal(parseModelTierEnv(env).Orchestrator, "orch-override-model");
    assert.equal(resolveModelTier("Orchestrator", "x", env).model, "orch-override-model");
  });

  it("ignores invalid Orchestrator override without echoing secrets", () => {
    const SECRET = "xai-ORCHSECRET-0123456789abcdef";
    const env = { MIND_MODEL_ORCHESTRATOR: SECRET };
    assert.equal(parseModelTierEnv(env).Orchestrator, "grok-4.7");
    const issues = modelTierEnvIssues(env);
    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes("MIND_MODEL_ORCHESTRATOR"));
    assert.equal(issues.join(" ").includes(SECRET), false);
  });

  it("is never chosen by Auto routing", () => {
    const probes = [
      "Hi",
      "Explain how DNS works in detail please with examples across resolvers.",
      "Please prove this rigorously with a formal proof of correctness.",
      "Please refactor this TypeScript function:\n```ts\nexport const x = 1\n```",
      "x".repeat(2000),
      "orchestrate the agents and coordinate tools for this workflow",
    ];
    for (const prompt of probes) {
      assert.notEqual(routeAutoTier(prompt).tier, "Orchestrator");
      assert.notEqual(resolveModelTier("Auto", prompt, {}).resolved, "Orchestrator");
    }
  });

  it("chip label matches done.model for Orchestrator", () => {
    const resolved = resolveModelTier("Orchestrator", "probe", {});
    const label = chipLabelForTier({
      selected: "Orchestrator",
      lastResolved: "Orchestrator",
      lastModel: resolved.model,
    });
    assert.equal(label, `Orchestrator · ${resolved.model}`);
    assert.ok(label.includes(resolved.model));
  });
});

describe("chipLabelForTier after leaving Auto", () => {
  it("does not keep Auto-turn model on Orchestrator when lastResolved is still Fast", () => {
    const label = chipLabelForTier({
      selected: "Orchestrator",
      lastResolved: "Fast",
      lastModel: "grok-fast-from-auto",
    });
    assert.equal(label, "Orchestrator");
  });

  it("still shows Auto→resolved while selected is Auto", () => {
    const label = chipLabelForTier({
      selected: "Auto",
      lastResolved: "Fast",
      lastModel: "grok-fast-from-auto",
    });
    assert.equal(label, "Auto→Fast · grok-fast-from-auto");
  });
});

describe("isConcreteModelTier", () => {
  it("accepts Orchestrator and other concrete tiers, rejects Auto and junk", () => {
    assert.equal(isConcreteModelTier("Orchestrator"), true);
    assert.equal(isConcreteModelTier("Fast"), true);
    assert.equal(isConcreteModelTier("Auto"), false);
    assert.equal(isConcreteModelTier("Nope"), false);
    assert.equal(isConcreteModelTier(null), false);
  });
});
