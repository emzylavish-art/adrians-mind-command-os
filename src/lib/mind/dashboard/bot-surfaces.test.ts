import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commitsForBranch,
  composeBotNotes,
  queueItemsForBot,
  sanitizeLockCommitLines,
} from "./bot-detail.ts";
import { parseDashboardQueueMarkdown } from "./queue-parse.ts";
import { parseLaneQueueMarkdown } from "./lane-queue.ts";
import {
  clearBranchCommitCache,
  collectBranchCommits,
  collectKnownBotBranchCommits,
} from "./git.ts";
import type { BotNode, GitCommit } from "./types.ts";

function bot(partial: Partial<BotNode> & { id: BotNode["id"] }): BotNode {
  return {
    name: partial.name ?? partial.id,
    health: "healthy",
    lock: null,
    branch: null,
    lastActivityAt: null,
    commits: [],
    notes: "",
    reason: "ok",
    ...partial,
  };
}

describe("surface fill — commits / notes / queue", () => {
  it("commitsForBranch does not substring-match dashboard into visual-motion", () => {
    const commits: GitCommit[] = [
      { sha: "aaa", subject: "hub", author: "x", date: "2026-11-01T10:00:00+01:00", branch: "dashboard-3d" },
      { sha: "bbb", subject: "motion", author: "x", date: "2026-11-01T11:00:00+01:00", branch: "dashboard-3d-visual-motion" },
    ];
    assert.deepEqual(
      commitsForBranch(commits, "dashboard-3d", 8, "dashboard").map((c) => c.sha),
      ["aaa"],
    );
    assert.deepEqual(
      commitsForBranch(commits, "dashboard-3d-visual-motion", 8, "cosmos-motion").map((c) => c.sha),
      ["bbb"],
    );
  });

  it("sanitizeLockCommitLines strips control chars", () => {
    assert.deepEqual(sanitizeLockCommitLines(["ab17f6f ok", "bad\u0000line", ""]), ["ab17f6f ok", "bad line"]);
  });

  it("composeBotNotes merges lock + notion titles without inventing", () => {
    assert.equal(composeBotNotes({}), "");
    const n = composeBotNotes({
      lockNotes: "Cycle 21 complete",
      notionTitles: ["c52 stop-point", "Cycle 21 complete"],
    });
    assert.match(n, /Cycle 21 complete/);
    assert.match(n, /c52 stop-point/);
  });

  it("queueItemsForBot matches Conductor rows", () => {
    const items = parseDashboardQueueMarkdown(
      "| 6 | **Feed** — Conductor nudges | **done** | c13 |\n",
    );
    const hits = queueItemsForBot(items, bot({ id: "conductor", name: "Conductor" }), "Conductor");
    assert.equal(hits.length, 1);
  });

  it("parseLaneQueueMarkdown reads headings safely", () => {
    const items = parseLaneQueueMarkdown("## Traveler focus churn + trail batch (c21)\n\nhi\n", "motion/INTEGRATION.md");
    assert.ok(items.some((i) => /Traveler focus churn/.test(i.title)));
  });
});

describe("attacker pass — git log / branch / queue", () => {
  it("huge per-branch limit clamps and dirty branches are skipped", () => {
    clearBranchCommitCache();
    const repo = process.cwd();
    const huge = collectBranchCommits(repo, ["dashboard-3d"], 99999);
    assert.ok(huge.length <= 500);
    const dirty = collectBranchCommits(repo, ["feat/\nrm -rf", "dashboard-3d\u0000x", "-C"], 8);
    // may be empty or only valid if somehow listed — never throws
    assert.ok(Array.isArray(dirty));
    clearBranchCommitCache();
    const cached = collectKnownBotBranchCommits(repo, Date.now(), { limitPerBranch: 3 });
    assert.ok(Array.isArray(cached));
  });

  it("malformed queue markdown never throws", () => {
    assert.deepEqual(parseDashboardQueueMarkdown(null as never), []);
    assert.deepEqual(parseDashboardQueueMarkdown(undefined), []);
    assert.deepEqual(parseDashboardQueueMarkdown(""), []);
    assert.deepEqual(parseDashboardQueueMarkdown("| not | a | row |\n| x | y | z |\n"), []);
    assert.ok(
      parseDashboardQueueMarkdown("| 1 | **Ok** — detail | **queued** | note |\n" + "x".repeat(600_000)).length <= 200,
    );
  });
});
