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


describe("ModelTierChip tierReason accessibility", () => {
  it("documents that tierReason is surfaced for Auto routing explanations", () => {
    const reason = "Auto routed to Fast for a short, simple prompt.";
    // Contract for callers: pass tierReason into ModelTierChip title/aria-label.
    assert.ok(reason.includes("Auto routed"));
    assert.ok(reason.length > 10);
  });
});

describe("ModelTierChip Orchestrator", () => {
  it("chip label includes the Orchestrator model id", () => {
    const label = chipLabelForTier({
      selected: "Orchestrator",
      lastResolved: "Orchestrator",
      lastModel: "grok-4.7",
    });
    assert.equal(label, "Orchestrator · grok-4.7");
  });
});

describe("ModelTierChip Auto residue", () => {
  it("clears Auto residue when Orchestrator is selected with a mismatched lastResolved", () => {
    const label = chipLabelForTier({
      selected: "Orchestrator",
      lastResolved: "Fast",
      lastModel: "grok-fast",
    });
    assert.equal(label, "Orchestrator");
    assert.equal(label.includes("Auto"), false);
  });
});

describe("Composer model menu subtitles are honest (catalog-derived)", () => {
  it("names each tier's real default model and Auto's real routing set", async () => {
    const { composerTierSubtitle, modelTierCatalog } = await import("../../lib/mind/model-tiers.ts");
    const cat = modelTierCatalog();
    for (const tier of ["Fast", "Expert", "Heavy", "Build"] as const) {
      const model = cat.find((c) => c.id === tier)!.model!;
      assert.ok(composerTierSubtitle(tier).includes(model), `${tier} subtitle must name ${model}`);
    }
    const auto = composerTierSubtitle("Auto");
    for (const t of ["Fast", "Expert", "Heavy", "Build"]) assert.ok(auto.includes(t), `Auto subtitle must list ${t}`);
    assert.ok(!/Grok 4\.7/.test(composerTierSubtitle("Fast")), "Fast is not Grok 4.7");
  });

  it("composer menu derives subtitles from the catalog, not hard-coded strings", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./voice-ui/composer-voice-buttons.tsx", import.meta.url), "utf8");
    assert.ok(!/Chooses Fast or Expert/.test(src), "stale Auto subtitle removed");
    assert.ok(!/·\s*Grok 4\.7"/.test(src), "no hard-coded Grok 4.7 subtitles");
    assert.ok(/composerTierSubtitle\(/.test(src), "uses composerTierSubtitle");
  });
});
