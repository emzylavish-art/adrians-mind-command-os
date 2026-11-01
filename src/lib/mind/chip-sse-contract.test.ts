import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chipLabelForTier, resolveModelTier, type ModelTier } from "./model-tiers.ts";
import { pullMindEvents } from "./stream.ts";

/**
 * Contract: after a turn, the header chip label must include the SSE done.model id
 * (same string the provider returned / relay echoed).
 */
describe("chip label ↔ SSE done.model contract", () => {
  for (const tier of ["Fast", "Expert", "Heavy", "Build", "Auto"] as ModelTier[]) {
    it(`includes done.model in the chip label for ${tier}`, () => {
      const prompt = tier === "Auto" ? "Hi" : "probe";
      const resolved = resolveModelTier(tier, prompt, {});
      const sse = `event: done\ndata: ${JSON.stringify({
        text: "OK",
        model: resolved.model,
        usage: null,
        usedIds: [],
        requestId: "req-contract",
        modelTier: resolved.selected,
        resolvedTier: resolved.resolved,
        tierReason: resolved.reason,
      })}\n\n`;
      const events = pullMindEvents(sse).events;
      const done = events.find((event) => event.event === "done");
      assert.ok(done && done.event === "done");
      if (!done || done.event !== "done") return;
      assert.equal(done.model, resolved.model);
      const label = chipLabelForTier({
        selected: resolved.selected,
        lastResolved: resolved.resolved,
        lastModel: done.model,
      });
      assert.ok(label.includes(done.model), `label ${label} must include ${done.model}`);
      if (resolved.selected === "Auto") {
        assert.ok(label.startsWith("Auto→"), label);
      }
    });
  }
});
