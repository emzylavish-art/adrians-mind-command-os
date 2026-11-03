import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MODEL_TIERS } from "./model-tiers.ts";
import { composerChipModelForTier, modelTierForComposerChip } from "./composer-chip-sync.ts";

test("composer model chip maps every real tier; Orchestrator has no chip option (null, not a lie)", () => {
  assert.equal(composerChipModelForTier("Auto"), "auto");
  assert.equal(composerChipModelForTier("Fast"), "fast");
  assert.equal(composerChipModelForTier("Expert"), "expert");
  assert.equal(composerChipModelForTier("Heavy"), "heavy");
  assert.equal(composerChipModelForTier("Build"), "build");
  assert.equal(composerChipModelForTier("Orchestrator"), null);
});

test("chip option round-trips to the same ModelTier the Mode picker uses", () => {
  for (const tier of MODEL_TIERS) {
    const id = composerChipModelForTier(tier);
    if (id) assert.equal(modelTierForComposerChip(id), tier);
  }
});

test("unknown / hostile chip ids are refused (null), never silently coerced to a tier", () => {
  for (const bad of ["", "orchestrator", "Heavy", "__proto__", "constructor", "toString", null, undefined, 1, {}]) {
    assert.equal(modelTierForComposerChip(bad as unknown), null, String(bad));
  }
});

test("command-app composer chip is wired to the chat's real modelTier, not a local preview stub", () => {
  const src = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
  assert.ok(!src.includes('markPreview("Model chip")'), "model chip must not be a markPreview stub");
  assert.ok(!/useState<ComposerModelId>/.test(src), "no local previewModel state detached from modelTier");
  assert.ok(/model=\{composerChipModelForTier\(modelTier\)\}/.test(src), "chip shows the real tier");
  assert.ok(/modelTierForComposerChip\(id\)/.test(src) && /onModelTier\(/.test(src), "chip select calls onModelTier");
  assert.ok(!src.includes("This chip does not change the chat model"), "stale disclaimer removed");
});
