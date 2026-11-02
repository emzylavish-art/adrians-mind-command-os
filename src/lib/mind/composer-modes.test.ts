import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPOSER_MODES,
  composerModeToModelTier,
  loadComposerEffort,
  modelTierToComposerMode,
  resolveSendPath,
  saveComposerEffort,
  type ComposerModeId,
} from "./composer-modes.ts";
import { MODEL_TIERS, resolveModelTier, type ModelTier } from "./model-tiers.ts";

describe("composer modes", () => {
  it("lists all six modes including Orchestrator", () => {
    assert.deepEqual(
      COMPOSER_MODES.map((mode) => mode.id),
      ["auto", "fast", "expert", "heavy", "build", "orchestrator"],
    );
  });

  it("maps every effort mode onto MODEL_TIERS both ways", () => {
    const modes: ComposerModeId[] = ["auto", "fast", "expert", "heavy", "build", "orchestrator"];
    for (const mode of modes) {
      const tier = composerModeToModelTier(mode);
      assert.ok((MODEL_TIERS as readonly string[]).includes(tier));
      assert.equal(modelTierToComposerMode(tier), mode);
    }
    for (const tier of MODEL_TIERS) {
      assert.equal(composerModeToModelTier(modelTierToComposerMode(tier)), tier);
    }
  });

  it("choosing an effort changes the modelTier that would be sent on the request body", () => {
    const cases: { mode: ComposerModeId; expected: ModelTier; model: string }[] = [
      { mode: "auto", expected: "Auto", model: resolveModelTier("Auto", "Hi", {}).model },
      { mode: "fast", expected: "Fast", model: "grok-4.20-0309-non-reasoning" },
      { mode: "expert", expected: "Expert", model: "grok-4.5" },
      { mode: "heavy", expected: "Heavy", model: "grok-4.7" },
      { mode: "build", expected: "Build", model: "grok-build-0.1" },
      { mode: "orchestrator", expected: "Orchestrator", model: "grok-4.7" },
    ];
    for (const item of cases) {
      const modelTier = composerModeToModelTier(item.mode);
      assert.equal(modelTier, item.expected);
      const body = { modelTier };
      const resolved = resolveModelTier(body.modelTier, item.mode === "auto" ? "Hi" : "probe", {});
      assert.equal(resolved.selected, item.expected);
      assert.equal(resolved.model, item.model);
    }
  });

  it("keeps Orchestrator send on Direct with an honest fan-out notice", () => {
    const resolved = resolveSendPath("orchestrator");
    assert.equal(resolved.path, "orchestrator-notice");
    assert.equal(resolved.badge, "Orchestrator");
    assert.match(resolved.notice ?? "", /fan-out/i);
    assert.equal(composerModeToModelTier("orchestrator"), "Orchestrator");
  });

  it("maps Auto/Build to Direct", () => {
    assert.equal(resolveSendPath("auto").path, "direct");
    assert.equal(resolveSendPath("build").path, "direct");
  });

  it("round-trips effort selection in storage", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
    };
    saveComposerEffort(storage, "expert");
    assert.equal(loadComposerEffort(storage), "expert");
    assert.equal(loadComposerEffort(null), "auto");
  });

  it("does not claim Fast/Expert/Heavy share one unconfigured Direct model", () => {
    for (const id of ["fast", "expert", "heavy"] as const) {
      const detail = COMPOSER_MODES.find((mode) => mode.id === id)?.detail ?? "";
      assert.equal(/Same Direct path|No separate .+ model is configured/i.test(detail), false);
      assert.match(detail, /Uses the .+ tier model/i);
    }
  });
});
