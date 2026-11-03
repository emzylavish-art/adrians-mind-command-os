import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { outcomeFromDoneEvent, readTierOutcome, rememberTierOutcome } from "./model-tier-memory.ts";

describe("model tier memory", () => {
  it("stores and reads the last Auto routing reason for chip aria", () => {
    const storage = new Map<string, string>();
    const fake = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    } as unknown as Storage;
    const outcome = outcomeFromDoneEvent({
      model: "grok-4.5",
      modelTier: "Auto",
      resolvedTier: "Expert",
      tierReason: "Auto routed to Expert for a medium-complexity prompt.",
    });
    assert.ok(outcome);
    rememberTierOutcome(outcome!, fake);
    const read = readTierOutcome(fake);
    assert.equal(read?.model, "grok-4.5");
    assert.match(read?.reason ?? "", /Expert/);
  });
});

describe("model tier memory Orchestrator", () => {
  it("accepts Orchestrator selected and resolved from a done event", () => {
    const outcome = outcomeFromDoneEvent({
      model: "grok-4.7",
      modelTier: "Orchestrator",
      resolvedTier: "Orchestrator",
      tierReason: "Owner selected Orchestrator.",
    });
    assert.ok(outcome);
    assert.equal(outcome!.selected, "Orchestrator");
    assert.equal(outcome!.resolved, "Orchestrator");
    assert.equal(outcome!.model, "grok-4.7");
  });

  it("rejects unknown tiers", () => {
    assert.equal(
      outcomeFromDoneEvent({
        model: "x",
        modelTier: "Nope",
        resolvedTier: "Fast",
      }),
      null,
    );
  });
});
