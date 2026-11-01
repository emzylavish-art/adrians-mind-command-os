import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chipLabelForTier, selectModelTier } from "../../lib/mind/model-tiers.ts";

describe("ModelTierChip label contract", () => {
  it("keeps picker and chip on the same selected tier value", () => {
    const fromChip = selectModelTier("Fast");
    const fromPicker = selectModelTier(fromChip);
    assert.equal(fromChip, fromPicker);
    assert.equal(fromPicker, "Fast");
  });

  it("exposes Auto routing outcome on the chip after a turn", () => {
    const label = chipLabelForTier({
      selected: "Auto",
      lastResolved: "Fast",
      lastModel: "grok-4.20-0309-non-reasoning",
    });
    assert.equal(label, "Auto→Fast · grok-4.20-0309-non-reasoning");
  });
});
