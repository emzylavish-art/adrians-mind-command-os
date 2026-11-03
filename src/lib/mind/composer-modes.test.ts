import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  COMPOSER_MODES,
  composerModeToModelTier,
  effortSelection,
  isComposerModeId,
  tierSelection,
  loadComposerEffort,
  modelTierToComposerMode,
  resolveSendPath,
  saveComposerEffort,
  type ComposerModeId,
  selectionEffects,
  readStoredSelection,
  crossTabSelection,
  MODEL_TIER_KEY,
  COMPOSER_EFFORT_KEY,
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

describe("Mode/Effort selection sync (hostile input)", () => {
  it("every tier selection yields a matching Effort and round-trips", () => {
    for (const tier of MODEL_TIERS) {
      const picked = tierSelection(tier);
      assert.ok(picked);
      assert.equal(picked.tier, tier);
      assert.equal(composerModeToModelTier(picked.mode), tier);
      assert.deepEqual(effortSelection(picked.mode), picked);
    }
  });
  it("refuses unknown, mis-cased, and prototype tier names from the intent predictor", () => {
    for (const bad of ["heavy", "HEAVY", "Grok", "", " Auto", "__proto__", "constructor", "toString", null, undefined, 3, {}, ["Fast"]]) {
      assert.equal(tierSelection(bad), null, String(bad));
    }
  });
  it("refuses unknown effort ids instead of desyncing Mode to undefined", () => {
    for (const bad of ["Auto", "turbo", "", "__proto__", "hasOwnProperty", null, undefined, 1]) {
      assert.equal(isComposerModeId(bad), false, String(bad));
      assert.equal(effortSelection(bad), null, String(bad));
    }
  });
  it("rapid alternating selections always end on a consistent pair", () => {
    let state = { tier: "Auto" as ModelTier, mode: "auto" as ComposerModeId };
    const inputs: unknown[] = ["Heavy", "fast", "bogus", "Build", "orchestrator", "__proto__", "Expert", "auto", "Fast"];
    for (let i = 0; i < 200; i++) {
      const raw = inputs[i % inputs.length];
      const next = (typeof raw === "string" && /^[A-Z]/.test(raw) ? tierSelection(raw) : effortSelection(raw)) ?? state;
      state = next;
      assert.equal(composerModeToModelTier(state.mode), state.tier);
    }
  });
});

function mem(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return { getItem: (k: string) => (data.has(k) ? data.get(k)! : null) };
}

describe("Build parity: Mode picker vs Effort row", () => {
  it("Build from either surface yields identical state and identical Build-surface effect", () => {
    const fromPicker = tierSelection("Build");
    const fromEffort = effortSelection("build");
    assert.deepEqual(fromPicker, fromEffort);
    assert.deepEqual(selectionEffects(fromPicker!), selectionEffects(fromEffort!));
    assert.equal(selectionEffects(fromPicker!).openBuild, true);
  });
  it("every tier has identical effects whether picked as tier or as effort", () => {
    for (const tier of MODEL_TIERS) {
      const a = tierSelection(tier)!;
      const b = effortSelection(modelTierToComposerMode(tier))!;
      assert.deepEqual(selectionEffects(a), selectionEffects(b), tier);
      assert.equal(selectionEffects(a).openBuild, tier === "Build");
    }
  });
  it("Orchestrator notice is shown from the Mode picker too, not only the Effort row", () => {
    assert.match(selectionEffects(tierSelection("Orchestrator")!).notice ?? "", /fan-out/i);
    assert.equal(selectionEffects(tierSelection("Fast")!).notice, null);
  });
});

describe("stored Mode/Effort hydration and cross-tab drift", () => {
  it("tier key wins; effort key used only when tier key is missing or hostile", () => {
    assert.deepEqual(readStoredSelection(mem({ [MODEL_TIER_KEY]: "Heavy", [COMPOSER_EFFORT_KEY]: "fast" })), { tier: "Heavy", mode: "heavy" });
    assert.deepEqual(readStoredSelection(mem({ [MODEL_TIER_KEY]: "__proto__", [COMPOSER_EFFORT_KEY]: "build" })), { tier: "Build", mode: "build" });
    assert.deepEqual(readStoredSelection(mem({ [MODEL_TIER_KEY]: "constructor", [COMPOSER_EFFORT_KEY]: "toString" })), { tier: "Auto", mode: "auto" });
    assert.deepEqual(readStoredSelection(mem()), { tier: "Auto", mode: "auto" });
    assert.deepEqual(readStoredSelection(null), { tier: "Auto", mode: "auto" });
    const throwing = { getItem: () => { throw new Error("SecurityError"); } };
    assert.deepEqual(readStoredSelection(throwing), { tier: "Auto", mode: "auto" });
  });
  it("another tab writing the effort key moves both picker and Effort row together", () => {
    assert.deepEqual(crossTabSelection(COMPOSER_EFFORT_KEY, "build", mem()), { tier: "Build", mode: "build" });
    assert.deepEqual(crossTabSelection(MODEL_TIER_KEY, "Expert", mem()), { tier: "Expert", mode: "expert" });
  });
  it("hostile cross-tab values are ignored (no desync, no garbage tier)", () => {
    for (const bad of ["__proto__", "Build ", "BUILD", "", "constructor", "{}"]) {
      assert.equal(crossTabSelection(COMPOSER_EFFORT_KEY, bad, mem()), null, bad);
      assert.equal(crossTabSelection(MODEL_TIER_KEY, bad, mem()), null, bad);
    }
  });
  it("unrelated keys are ignored; storage.clear() (key null) re-reads a consistent pair", () => {
    assert.equal(crossTabSelection("amcos.voice.choice.v1", "build", mem()), null);
    assert.deepEqual(crossTabSelection(null, null, mem({ [COMPOSER_EFFORT_KEY]: "heavy" })), { tier: "Heavy", mode: "heavy" });
    assert.deepEqual(crossTabSelection(null, null, mem()), { tier: "Auto", mode: "auto" });
  });
  it("removing a key in another tab re-reads the surviving key instead of desyncing", () => {
    assert.deepEqual(crossTabSelection(MODEL_TIER_KEY, null, mem({ [COMPOSER_EFFORT_KEY]: "fast" })), { tier: "Fast", mode: "fast" });
  });
});

describe("adversarial: Mode/Effort wiring in command-app", () => {
  const src = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
  const body = (name: string) => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start > 0, name);
    return src.slice(start, src.indexOf("\n  }\n", start));
  };
  it("both Effort row and Mode picker route through the single applyTierSelection path", () => {
    assert.match(body("chooseComposerEffort"), /applyTierSelection\(picked\)/);
    assert.match(body("chooseModelTier"), /applyTierSelection\(picked\)/);
    assert.doesNotMatch(body("chooseComposerEffort"), /setView\(/);
    assert.doesNotMatch(body("chooseModelTier"), /setView\(/);
    assert.match(body("applyTierSelection"), /selectionEffects\(picked\)/);
  });
  it("cross-tab listener validates via crossTabSelection and ignores non-localStorage areas", () => {
    assert.match(src, /crossTabSelection\(event\.key, event\.newValue/);
    assert.match(src, /event\.storageArea !== localStorage/);
  });
  it("hydration reads a reconciled pair (no raw tier cast from storage)", () => {
    assert.match(src, /readStoredSelection\(localStorage\)/);
    assert.doesNotMatch(src, /localStorage\.getItem\("amcos\.modelTier\.v1"\)/);
  });
});

describe("adversarial: cross-tab event sequences never leave picker and Effort row disagreeing", () => {
  it("interleaved, hostile, and clear events always end consistent", () => {
    const events: [string | null, string | null][] = [
      [COMPOSER_EFFORT_KEY, "build"], [MODEL_TIER_KEY, "Build"], [MODEL_TIER_KEY, "__proto__"],
      [COMPOSER_EFFORT_KEY, "Heavy"], [null, null], [MODEL_TIER_KEY, "Orchestrator"], [COMPOSER_EFFORT_KEY, "\u0000fast"],
      ["amcos.failover.v1", "grok"], [MODEL_TIER_KEY, null], [COMPOSER_EFFORT_KEY, "expert"],
    ];
    let state: TierSel = { tier: "Auto", mode: "auto" };
    for (let i = 0; i < 300; i++) {
      const [k, v] = events[i % events.length];
      state = crossTabSelection(k, v, mem({ [COMPOSER_EFFORT_KEY]: "heavy" })) ?? state;
      assert.equal(composerModeToModelTier(state.mode), state.tier);
      assert.ok((MODEL_TIERS as readonly string[]).includes(state.tier));
    }
  });
  it("a storage whose getItem returns non-strings cannot inject a tier", () => {
    const weird = { getItem: (() => ({ toString: () => "Build" })) as unknown as (k: string) => string | null };
    assert.deepEqual(readStoredSelection(weird), { tier: "Auto", mode: "auto" });
  });
  it("Build effects carry no notice; only Orchestrator carries one", () => {
    for (const tier of MODEL_TIERS) {
      const fx = selectionEffects(tierSelection(tier)!);
      assert.equal(fx.notice !== null, tier === "Orchestrator", tier);
    }
  });
});
type TierSel = { tier: ModelTier; mode: ComposerModeId };
