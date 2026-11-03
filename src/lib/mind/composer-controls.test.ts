import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chipLabelForTier, resolveModelTier, selectModelTier, type ModelTier } from "./model-tiers.ts";
import { chosenProvider } from "./providers.ts";
import { parseFailoverField } from "./failover.ts";

describe("chip ↔ Mode picker sync", () => {
  it("selectModelTier is the shared source of truth for both controls", () => {
    let tier: ModelTier = "Auto";
    const onChoose = (next: ModelTier) => {
      tier = selectModelTier(next);
    };
    // chip selects Fast
    onChoose("Fast");
    assert.equal(tier, "Fast");
    // picker selects Heavy — same state
    onChoose("Heavy");
    assert.equal(tier, "Heavy");
    // both would send the same modelTier on the next request
    const resolved = resolveModelTier(tier, "hello", {});
    assert.equal(resolved.selected, "Heavy");
    assert.equal(resolved.model, "grok-4.7");
  });

  it("chip label shows Auto→resolved and model after a turn", () => {
    assert.equal(chipLabelForTier({ selected: "Auto" }), "Auto");
    assert.equal(
      chipLabelForTier({ selected: "Auto", lastResolved: "Build", lastModel: "grok-build-0.1" }),
      "Auto→Build · grok-build-0.1",
    );
    assert.equal(chipLabelForTier({ selected: "Expert", lastModel: "grok-4.5" }), "Expert · grok-4.5");
    assert.equal(
      chipLabelForTier({ selected: "Expert", lastModel: "model unknown" }),
      "Expert · model unknown",
    );
    assert.equal(
      chipLabelForTier({ selected: "Auto", lastResolved: "Fast", lastModel: "model unknown" }),
      "Auto→Fast · model unknown",
    );

  });
});

describe("Settings provider failover toggle", () => {
  it("only a literal true on the request body enables server failover", () => {
    assert.equal(parseFailoverField(true), true);
    for (const v of [false, "true", 1, "grok", {}, null, undefined]) assert.equal(parseFailoverField(v), false);
    assert.equal(chosenProvider("grok", true).ok, true);
  });
});

describe("bounded agent Run payload", () => {
  it("includes modelTier and server resolve reports the model", () => {
    const modelTier: ModelTier = "Build";
    const body = {
      goal: "List chats",
      projects: [] as string[],
      chats: [] as string[],
      notes: [] as string[],
      modelTier,
    };
    assert.equal(body.modelTier, "Build");
    const tier = resolveModelTier(body.modelTier, body.goal, {});
    assert.equal(tier.model, "grok-build-0.1");
    const responseMeta = {
      model: tier.model,
      modelTier: tier.selected,
      resolvedTier: tier.resolved,
    };
    assert.equal(responseMeta.model, "grok-build-0.1");
    assert.match(`Model ${responseMeta.model} (${responseMeta.modelTier})`, /grok-build-0.1/);
  });
});
