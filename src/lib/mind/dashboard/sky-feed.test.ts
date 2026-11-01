import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_FEED_GLYPHS,
  MAX_PER_KIND,
  NO_SOURCE,
  buildSkyFeed,
  sanitizeFeedText,
} from "./sky-feed.ts";
import type { GitCommit, LockRecord } from "./types.ts";

const NOW = Date.parse("2026-11-01T18:00:00+01:00");

describe("sky-feed (hacker + queue #6)", () => {
  it("sanitizes HTML / long text and never executes markup", () => {
    const dirty =
      '<script>alert(1)</script><b onclick="x">Hello</b> &amp; <img src=x onerror=alert(2)> ' +
      "x".repeat(500);
    const clean = sanitizeFeedText(dirty, 80);
    assert.ok(!clean.includes("<"));
    assert.ok(!clean.includes("script"));
    assert.ok(clean.length <= 80);
    assert.match(clean, /Hello/);
  });

  it("rate-limits and dedupes event floods; drops stale", () => {
    const nudges = Array.from({ length: 40 }, (_, i) => `nudge-${i % 5}`); // many dupes
    const commits: GitCommit[] = Array.from({ length: 30 }, (_, i) => ({
      sha: `deadbeef${i}`,
      subject: `commit ${i}`,
      author: "bot",
      date: new Date(NOW - i * 60_000).toISOString(),
      branch: "dashboard-3d",
    }));
    // one very stale commit
    commits.push({
      sha: "oldold01",
      subject: "ancient",
      author: "bot",
      date: new Date(NOW - 10 * 24 * 3600_000).toISOString(),
      branch: "dashboard-3d",
    });

    const feed = buildSkyFeed({
      nowMs: NOW,
      conductor: { source: "/tmp/nudges.json", nudges },
      commits,
      gapDispatcher: { source: "unavailable", items: [] },
      maxPerKind: 8,
      maxGlyphs: 18,
      maxList: 24,
    });

    assert.ok(feed.droppedDupes >= 1);
    assert.ok(feed.droppedFlood >= 1 || feed.list.filter((e) => e.kind === "conductor").length <= MAX_PER_KIND);
    assert.ok(feed.droppedStale >= 1);
    assert.ok(feed.events.length <= MAX_FEED_GLYPHS);
    assert.equal(feed.sources.gap, NO_SOURCE);
    assert.notEqual(feed.sources.conductor, NO_SOURCE);
    // no raw HTML in any event
    for (const e of feed.list) {
      assert.ok(!e.text.includes("<"));
      assert.ok(e.text.length <= 140);
    }
  });

  it("maps lock transitions + landings + merge gate from real fields; missing = no source yet", () => {
    const locks: LockRecord[] = [
      {
        file: "merge-gate.lock",
        owner: "Merge Gate Bot",
        branch: "dashboard-3d",
        status: "done",
        claimed_at: "2026-11-01T17:00:00+01:00",
        released_at: "2026-11-01T17:10:00+01:00",
        commits: [],
        notes: "preview/integration wait — dashboard-3d.lock busy",
        worktree: null,
        raw: {},
      },
    ];
    const feed = buildSkyFeed({
      nowMs: NOW,
      locks,
      lockTransitionText:
        "2026-11-01T17:52:56+01:00\tclaimed\tDashboard Bot\tqueue #6 FEED\n" +
        "2026-11-01T17:52:56+01:00\tclaimed\tDashboard Bot\tqueue #6 FEED\n", // dupe line
      fleetPlan: {
        fleetStars: [],
        landings: [
          {
            lane: "light",
            botId: "cosmos-light",
            branch: "dashboard-3d-visual-light",
            remoteOk: true,
            remoteUrl: "https://github.com/emzylavish-art/adrians-mind-command-os.git",
            expectedRemoteIncludes: "adrians-mind-command-os",
            tipSha: "e9262cb",
            hops: [
              { hop: "fleet-branch", ref: "x", sha: "e9262cb", reached: true, note: "ok" },
              { hop: "dashboard-3d", ref: "y", sha: "abc", reached: true, note: "ok" },
              { hop: "preview/integration", ref: "z", sha: null, reached: false, note: "no" },
              { hop: "main", ref: "m", sha: null, reached: false, note: "no" },
            ],
            mergedIntoDashboard3d: true,
            mergedIntoPreviewIntegration: false,
            mergedIntoMain: false,
            mergeGate: { watching: true, note: "watching" },
          },
        ],
        queue: [],
        queueHead: null,
        mergeGateNote: "Merge Gate watches dashboard-3d",
      },
      notionGraph: {
        available: false,
        mode: "unavailable",
        generatedAt: null,
        pages: [],
        edges: [],
        botPageMap: {},
        stats: { pages: 0, edges: 0, botsMapped: 0 },
      },
    });

    assert.ok(feed.list.some((e) => e.kind === "lock"));
    assert.ok(feed.list.some((e) => e.kind === "landing" && e.botId === "cosmos-light"));
    assert.ok(feed.list.some((e) => e.kind === "merge_gate" && e.botId === "merge-gate"));
    assert.equal(feed.sources.notion_stop, NO_SOURCE);
    assert.equal(feed.sources.conductor, NO_SOURCE);
    assert.ok(feed.droppedDupes >= 1);
  });
});
