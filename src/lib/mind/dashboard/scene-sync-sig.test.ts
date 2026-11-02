import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dashboardRebuildCardsDigest,
  dashboardRebuildPagesDigest,
  dashboardSceneSyncSignature,
  type SceneSyncInput,
} from "./scene-sync-sig.ts";

function base(): SceneSyncInput {
  return {
    bots: [
      {
        id: "logic",
        health: "healthy",
        lock: { status: "claimed", claimed_at: "2026-11-02T10:00:00Z", notes: "wiring" },
      },
    ],
    constellationEdges: [{ from: "logic", to: "grok-build", health: "healthy", kind: "hub" }],
    skyFeed: { events: [{ id: "feed-1" }, { id: "feed-2" }] },
    commits: [
      { sha: "abc", subject: "feat: one" },
      { sha: "def", subject: "fix: two" },
    ],
    fleetPlan: {
      landings: [{ lane: "logic", tipSha: "abc" }],
      queueHead: { index: 1, title: "next" },
    },
    weather: { tone: "healthy", label: "Clear skies", summary: "1 healthy" },
    orchestrator: { owner: "Logic", status: "claimed", branch: "dashboard-3d" },
    gapDispatcher: {
      source: "/workspace/rea-captures",
      items: [
        { rank: 1, feature: "Gap A" },
        { rank: 2, feature: "Gap B" },
      ],
    },
    spend: { available: false, reason: "no spend log" },
    conductor: { source: "nudges.json", nudges: ["keep shipping", "wire painter"] },
    notionGraph: {
      pages: [
        { id: "p1", title: "Logic handoff" },
        { id: "p2", title: "Fleet" },
      ],
      edges: [{ from: "p1", to: "p2", kind: "child" }],
    },
  };
}

describe("dashboardSceneSyncSignature (c59 + Gap #67 cards/pages)", () => {
  it("is stable for identical data", () => {
    assert.equal(dashboardSceneSyncSignature(base()), dashboardSceneSyncSignature(base()));
  });

  it("changes when bot health changes", () => {
    const a = dashboardSceneSyncSignature(base());
    const b = dashboardSceneSyncSignature({
      ...base(),
      bots: [{ ...base().bots![0]!, health: "stalled" }],
    });
    assert.notEqual(a, b);
  });

  it("changes when lock claimed_at changes", () => {
    const a = dashboardSceneSyncSignature(base());
    const b = dashboardSceneSyncSignature({
      ...base(),
      bots: [
        {
          ...base().bots![0]!,
          lock: { ...base().bots![0]!.lock!, claimed_at: "2026-11-02T11:00:00Z" },
        },
      ],
    });
    assert.notEqual(a, b);
  });

  it("changes when feed ids change", () => {
    const a = dashboardSceneSyncSignature(base());
    const b = dashboardSceneSyncSignature({
      ...base(),
      skyFeed: { events: [{ id: "feed-1" }, { id: "feed-9" }] },
    });
    assert.notEqual(a, b);
  });

  it("unchanged when only irrelevant object identity differs", () => {
    const a = dashboardSceneSyncSignature(base());
    const b = dashboardSceneSyncSignature(JSON.parse(JSON.stringify(base())));
    assert.equal(a, b);
  });

  it("empty / null inputs are honest empty", () => {
    assert.equal(dashboardSceneSyncSignature(null), "empty");
    assert.equal(dashboardSceneSyncSignature({}), "empty");
  });
});

describe("Gap #67 — signature tracks rebuildCards / rebuildPages inputs", () => {
  it("cards digest mirrors rebuildCards fields", () => {
    const d = dashboardRebuildCardsDigest(base());
    assert.match(d, /w:healthy:Clear skies/);
    assert.match(d, /o:Logic:claimed:dashboard-3d/);
    assert.match(d, /Gap A/);
    assert.match(d, /s:no spend log/);
    assert.match(d, /keep shipping/);
    assert.match(d, /cs:abc:feat: one/);
  });

  it("pages digest mirrors rebuildPages id+title + child edges", () => {
    const d = dashboardRebuildPagesDigest(base());
    assert.match(d, /p:p1:Logic handoff/);
    assert.match(d, /pe:p1>p2/);
  });

  const flips: Array<{ name: string; mutate: (s: SceneSyncInput) => SceneSyncInput }> = [
    {
      name: "weather.tone",
      mutate: (s) => ({ ...s, weather: { ...s.weather!, tone: "stalled" } }),
    },
    {
      name: "weather.label",
      mutate: (s) => ({ ...s, weather: { ...s.weather!, label: "Amber" } }),
    },
    {
      name: "weather.summary",
      mutate: (s) => ({ ...s, weather: { ...s.weather!, summary: "2 stalled" } }),
    },
    {
      name: "orchestrator.owner",
      mutate: (s) => ({ ...s, orchestrator: { ...s.orchestrator!, owner: "Painter" } }),
    },
    {
      name: "orchestrator.status",
      mutate: (s) => ({ ...s, orchestrator: { ...s.orchestrator!, status: "free" } }),
    },
    {
      name: "orchestrator.branch",
      mutate: (s) => ({ ...s, orchestrator: { ...s.orchestrator!, branch: "other" } }),
    },
    {
      name: "gapDispatcher.items",
      mutate: (s) => ({
        ...s,
        gapDispatcher: {
          ...s.gapDispatcher!,
          items: [{ rank: 9, feature: "New gap" }],
        },
      }),
    },
    {
      name: "gapDispatcher.source",
      mutate: (s) => ({
        ...s,
        gapDispatcher: { ...s.gapDispatcher!, source: "unavailable" },
      }),
    },
    {
      name: "spend.available/reason",
      mutate: (s) => ({ ...s, spend: { available: true } }),
    },
    {
      name: "conductor.nudges",
      mutate: (s) => ({
        ...s,
        conductor: { ...s.conductor!, nudges: ["new nudge"] },
      }),
    },
    {
      name: "commit subject",
      mutate: (s) => ({
        ...s,
        commits: [{ sha: "abc", subject: "feat: changed subject" }, s.commits![1]!],
      }),
    },
    {
      name: "notion page id",
      mutate: (s) => ({
        ...s,
        notionGraph: {
          ...s.notionGraph!,
          pages: [{ id: "p9", title: "Logic handoff" }, s.notionGraph!.pages![1]!],
        },
      }),
    },
    {
      name: "notion page title",
      mutate: (s) => ({
        ...s,
        notionGraph: {
          ...s.notionGraph!,
          pages: [{ id: "p1", title: "Renamed" }, s.notionGraph!.pages![1]!],
        },
      }),
    },
  ];

  for (const flip of flips) {
    it(`signature changes when ${flip.name} flips`, () => {
      const before = dashboardSceneSyncSignature(base());
      const after = dashboardSceneSyncSignature(flip.mutate(base()));
      assert.notEqual(before, after, `expected flip for ${flip.name}`);
    });
  }
});
