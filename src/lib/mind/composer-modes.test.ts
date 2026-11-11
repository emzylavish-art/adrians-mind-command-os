import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effortForModelTier, effortModelTier, loadComposerEffort, resolveSendPath, saveComposerEffort } from "./composer-modes.ts";

describe("composer modes", () => {
  it("keeps text send on Direct until a paired computer can run Orchestrator", () => {
    const resolved = resolveSendPath("orchestrator");
    assert.equal(resolved.path, "blocked-orchestrator");
    assert.equal(resolved.badge, "Direct");
    assert.match(resolved.notice ?? "", /Direct/i);
  });

  it("maps Auto to Direct", () => {
    const resolved = resolveSendPath("auto");
    assert.equal(resolved.path, "direct");
    assert.equal(resolved.badge, "Direct");
    assert.equal(resolved.notice, null);
  });

  it("maps Build to Direct with no second model path", () => {
    const resolved = resolveSendPath("build");
    assert.equal(resolved.path, "direct");
    assert.equal(resolved.badge, "Direct");
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

  it("maps Fast, Expert, and Heavy to the existing Grok tiers", () => {
    assert.equal(effortModelTier("fast"), "Fast");
    assert.equal(effortModelTier("expert"), "Expert");
    assert.equal(effortModelTier("heavy"), "Heavy");
    assert.equal(effortModelTier("auto"), "Auto");
    assert.equal(effortModelTier("build"), null);
    assert.equal(effortModelTier("orchestrator"), null);
    assert.equal(effortForModelTier("Fast"), "fast");
    assert.equal(effortForModelTier("Build"), null);
  });
});
