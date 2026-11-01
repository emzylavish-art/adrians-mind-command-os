import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDashboardQueueMarkdown, queueHead, queueWaypointPositions } from "./queue-parse.ts";

const SAMPLE = `
| # | Upgrade | Status | Notes |
|---|---------|--------|-------|
| 0 | **Universe** — painted | **done** @ abcdef0 | Pushed |
| 1 | **Camera / city** — flyover | **active** | Now |
| 2 | **Click-and-zoom** — dolly | queued | Next |
`;

describe("queue-parse", () => {
  it("parses done/active/queued rows with optional sha", () => {
    const items = parseDashboardQueueMarkdown(SAMPLE);
    assert.equal(items.length, 3);
    assert.equal(items[0]!.status, "done");
    assert.equal(items[0]!.sha, "abcdef0");
    assert.equal(items[1]!.status, "active");
    assert.equal(items[2]!.status, "queued");
    assert.match(items[0]!.title, /Universe/i);
  });

  it("returns active head preferably", () => {
    const head = queueHead(parseDashboardQueueMarkdown(SAMPLE));
    assert.equal(head?.index, 1);
  });

  it("lays out deterministic waypoint positions", () => {
    assert.deepEqual(queueWaypointPositions(2), queueWaypointPositions(2));
    assert.equal(queueWaypointPositions(3).length, 3);
  });
});
