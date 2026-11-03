import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chipLabelForTier } from "./model-tiers.ts";
import { chipPropsForSelection, forgetTierOutcome, readTierOutcome, rememberTierOutcome, tierRunFromResult } from "./model-tier-memory.ts";

const label = (run: ReturnType<typeof tierRunFromResult> | null, selected: Parameters<typeof chipPropsForSelection>[1]) =>
  chipLabelForTier({ selected, ...chipPropsForSelection(run, selected) });

describe("command-app chip tier run (Orchestrator / stale residue)", () => {
  it("records an Orchestrator turn instead of keeping a stale Auto→Fast", () => {
    const run = tierRunFromResult({ model: "grok-4.7", modelTier: "Orchestrator", resolvedTier: "Orchestrator" }, "Orchestrator");
    assert.deepEqual(run, { selected: "Orchestrator", resolved: "Orchestrator", model: "grok-4.7" });
    assert.equal(label(run, "Orchestrator"), "Orchestrator · grok-4.7");
  });

  it("does not show Auto→Fast or the Orchestrator model after Orchestrator turn then switching back to Auto", () => {
    const run = tierRunFromResult({ model: "grok-4.7", modelTier: "Orchestrator", resolvedTier: "Orchestrator" }, "Orchestrator");
    assert.equal(label(run, "Auto"), "Auto");
  });

  it("does not glue an Auto→Fast model onto a later Heavy selection", () => {
    const run = tierRunFromResult({ model: "grok-4.20-0309-non-reasoning", modelTier: "Auto", resolvedTier: "Fast" }, "Auto");
    assert.equal(label(run, "Auto"), "Auto→Fast · grok-4.20-0309-non-reasoning");
    assert.equal(label(run, "Heavy"), "Heavy");
  });

  it("clears the resolved tier when the server omits or forges resolvedTier (no stale residue)", () => {
    for (const resolvedTier of [undefined, "", "Auto", "__proto__", "constructor", "grok-evil", 7, null, { x: 1 }]) {
      const run = tierRunFromResult({ model: "grok-4.5", modelTier: "Auto", resolvedTier }, "Auto");
      assert.equal(run.resolved, null, String(resolvedTier));
      assert.equal(label(run, "Auto"), "Auto");
    }
  });

  it("uses the sent tier when the server omits modelTier; rejects forged modelTier", () => {
    assert.equal(tierRunFromResult({ model: "grok-4.5", resolvedTier: "Expert" }, "Auto").selected, "Auto");
    assert.equal(tierRunFromResult({ model: "grok-4.5", modelTier: "__proto__", resolvedTier: "Expert" }, "Expert").selected, "Expert");
  });

  it("drops non-string / empty / oversized model ids", () => {
    for (const model of [undefined, null, "", "   ", 42, {}, "x".repeat(200)]) {
      assert.equal(tierRunFromResult({ model, modelTier: "Fast", resolvedTier: "Fast" }, "Fast").model, null);
    }
  });

  it("null run yields empty chip props", () => {
    assert.deepEqual(chipPropsForSelection(null, "Auto"), { lastResolved: null, lastModel: null });
  });

  it("forgetTierOutcome clears remembered outcome so the chip cannot fall back to an older Auto→Fast", () => {
    const map = new Map<string, string>();
    const fake = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    } as unknown as Storage;
    rememberTierOutcome({ selected: "Auto", resolved: "Fast", model: "grok-4.20-0309-non-reasoning", reason: "r", at: "t" }, fake);
    assert.equal(readTierOutcome(fake)?.resolved, "Fast");
    forgetTierOutcome(fake);
    assert.equal(readTierOutcome(fake), null);
    const throwing = { removeItem: () => { throw new Error("SecurityError"); } } as unknown as Storage;
    assert.doesNotThrow(() => forgetTierOutcome(throwing));
  });
});
