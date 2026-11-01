import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_QUEUE_ROWS, parseDashboardQueueMarkdown, queueHead, queueWaypointPositions } from "./queue-parse.ts";

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

describe("queue-parse hacker c20 (silent row loss)", () => {
  it("keeps queued rows whose title has no '— detail' (status cell must not shift)", () => {
    const items = parseDashboardQueueMarkdown(`| 18 | **City night-shift windows** | queued | lock timestamps |`);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.status, "queued");
    assert.equal(items[0]!.title, "City night-shift windows");
    assert.equal(queueHead(items)?.index, 18);
  });

  it("parses bold titles containing an em dash with status in its own cell", () => {
    const items = parseDashboardQueueMarkdown(
      `| 11 | **Light — depth-aware god-ray shafts** | **done** | Landed+wired c9 |`,
    );
    assert.equal(items[0]!.status, "done");
    assert.match(items[0]!.title, /god-ray/);
    assert.match(items[0]!.detail, /Landed/);
  });

  it("does not read 'done' from notes into a queued status cell", () => {
    const items = parseDashboardQueueMarkdown(`| 19 | **Foo** — bar | queued | was done before, reopened |`);
    assert.equal(items[0]!.status, "queued");
  });

  it("dedupes repeated indexes (first wins) and caps huge input", () => {
    const dup = `| 2 | **A** — a | queued | |\n| 2 | **B** — b | done | |`;
    const items = parseDashboardQueueMarkdown(dup);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.title, "A");
    const huge = Array.from({ length: 50_000 }, (_, i) => `| ${i} | **Row ${i}** — x | queued | |`).join("\n");
    const t0 = Date.now();
    const many = parseDashboardQueueMarkdown(huge);
    assert.ok(many.length <= MAX_QUEUE_ROWS);
    assert.ok(Date.now() - t0 < 2000);
  });

  it("ignores header/separator rows and non-numeric index", () => {
    const items = parseDashboardQueueMarkdown(`| # | Upgrade | Status | Notes |\n|---|---|---|---|\n| x | **Bad** | queued | |`);
    assert.equal(items.length, 0);
  });
});
