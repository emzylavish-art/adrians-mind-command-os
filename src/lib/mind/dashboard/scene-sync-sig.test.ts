import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dashboardSceneSyncSignature } from "./scene-sync-sig.ts";

describe("dashboardSceneSyncSignature (c59 5s sync skip)", () => {
  const base = {
    bots: [
      {
        id: "logic",
        health: "healthy",
        lock: { status: "claimed", claimed_at: "2026-11-02T10:00:00Z", notes: "wiring" },
      },
    ],
    constellationEdges: [{ from: "logic", to: "grok-build", health: "healthy", kind: "hub" }],
    skyFeed: { events: [{ id: "feed-1" }, { id: "feed-2" }] },
    commits: [{ sha: "abc" }, { sha: "def" }],
    fleetPlan: { landings: [{ lane: "logic", tipSha: "abc" }], queueHead: { index: 1, title: "next" } },
  };

  it("is stable for identical data", () => {
    assert.equal(dashboardSceneSyncSignature(base), dashboardSceneSyncSignature({ ...base }));
  });

  it("changes when bot health changes", () => {
    const a = dashboardSceneSyncSignature(base);
    const b = dashboardSceneSyncSignature({
      ...base,
      bots: [{ ...base.bots[0]!, health: "stalled" }],
    });
    assert.notEqual(a, b);
  });

  it("changes when lock claimed_at changes", () => {
    const a = dashboardSceneSyncSignature(base);
    const b = dashboardSceneSyncSignature({
      ...base,
      bots: [
        {
          ...base.bots[0]!,
          lock: { ...base.bots[0]!.lock!, claimed_at: "2026-11-02T11:00:00Z" },
        },
      ],
    });
    assert.notEqual(a, b);
  });

  it("changes when feed ids change", () => {
    const a = dashboardSceneSyncSignature(base);
    const b = dashboardSceneSyncSignature({
      ...base,
      skyFeed: { events: [{ id: "feed-1" }, { id: "feed-9" }] },
    });
    assert.notEqual(a, b);
  });

  it("unchanged when only irrelevant object identity differs", () => {
    const a = dashboardSceneSyncSignature(base);
    const b = dashboardSceneSyncSignature(JSON.parse(JSON.stringify(base)));
    assert.equal(a, b);
  });

  it("empty / null inputs are honest empty", () => {
    assert.equal(dashboardSceneSyncSignature(null), "empty");
    assert.equal(dashboardSceneSyncSignature({}), "empty");
  });
});
