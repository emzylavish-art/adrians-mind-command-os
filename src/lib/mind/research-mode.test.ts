import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RESEARCH_DEPTH_STORAGE_KEY,
  isResearchDepthMode,
  loadResearchDepth,
  saveResearchDepth,
  suggestDeepResearch,
} from "./research-mode.ts";

describe("research depth preference", () => {
  it("persists Search|Deep and never invents a third mode", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    assert.equal(loadResearchDepth(storage), "search");
    saveResearchDepth(storage, "deep");
    assert.equal(store.get(RESEARCH_DEPTH_STORAGE_KEY), "deep");
    assert.equal(loadResearchDepth(storage), "deep");
    assert.equal(isResearchDepthMode("nope"), false);
  });

  it("suggests deep for long queries without forcing a mode", () => {
    assert.equal(suggestDeepResearch("short"), false);
    assert.equal(suggestDeepResearch("x".repeat(160)), true);
    assert.equal(suggestDeepResearch("please deep research lakes"), true);
  });
});
