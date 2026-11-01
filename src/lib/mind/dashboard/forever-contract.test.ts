import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildForeverContractGuard,
  detectLaneIdle,
  queueHealthTone,
  sanitizeQueueTitle,
} from "./forever-contract.ts";
import { parseDashboardQueueMarkdown } from "./queue-parse.ts";
import type { BotNode } from "./types.ts";

const NOW = Date.parse("2026-11-01T18:00:00+01:00");

function bot(partial: Partial<BotNode> & Pick<BotNode, "id" | "name">): BotNode {
  return {
    health: "idle",
    lock: null,
    branch: null,
    lastActivityAt: null,
    commits: [],
    notes: "",
    reason: "",
    ...partial,
  };
}

describe("forever-contract (hacker + queue #10)", () => {
  it("tones: green≥3, amber 1–2, red empty; NaN→red", () => {
    assert.equal(queueHealthTone(5), "green");
    assert.equal(queueHealthTone(3), "green");
    assert.equal(queueHealthTone(2), "amber");
    assert.equal(queueHealthTone(1), "amber");
    assert.equal(queueHealthTone(0), "red");
    assert.equal(queueHealthTone(-1), "red");
    assert.equal(queueHealthTone(Number.NaN), "red");
  });

  it("sanitizes XSS in queue titles and bot names", () => {
    const dirty = '<img src=x onerror=alert(1)>Bot<script>evil()</script>';
    assert.equal(sanitizeQueueTitle(dirty).includes("<"), false);
    assert.equal(sanitizeQueueTitle(dirty).includes("script"), false);
    const g = buildForeverContractGuard({
      nowMs: NOW,
      queue: [
        {
          index: 99,
          title: dirty,
          status: "queued",
          detail: '<a href="javascript:alert(1)">x</a>',
        },
      ],
      bots: [bot({ id: "dashboard", name: dirty, health: "idle", lastActivityAt: "2026-11-01T10:00:00+01:00" })],
    });
    assert.equal(g.queued[0]!.title.includes("<"), false);
    assert.equal(g.needsNextTask[0]!.botName.includes("<"), false);
  });

  it("caps very large idle/queue lists", () => {
    const queue = Array.from({ length: 80 }, (_, i) => ({
      index: i,
      title: `Item ${i}`,
      status: "queued" as const,
      detail: "",
    }));
    const bots = Array.from({ length: 120 }, (_, i) =>
      bot({
        id: `dashboard`,
        name: `Bot ${i}`,
        health: "idle",
        lastActivityAt: "2026-11-01T10:00:00+01:00",
        lock: {
          file: `b${i}.lock`,
          owner: "x",
          branch: null,
          status: "released",
          claimed_at: null,
          released_at: "2026-11-01T10:00:00+01:00",
          commits: [],
          notes: "",
          worktree: null,
          raw: {},
        },
      }),
    );
    // force unique ids without expanding DashboardBotId union — cast for stress
    const stressed = bots.map((b, i) => ({ ...b, id: `bot-${i}` as BotNode["id"] }));
    const g = buildForeverContractGuard({ queue, bots: stressed, nowMs: NOW });
    assert.ok(g.queued.length <= 24);
    assert.ok(g.needsNextTask.length <= 40);
    assert.equal(g.tone, "green");
  });

  it("marks released/idle >30m with no new commit as needs next task", () => {
    const idle = bot({
      id: "cosmos-painter",
      name: "Painter",
      health: "idle",
      lastActivityAt: "2026-11-01T17:00:00+01:00", // 60m before NOW
      lock: {
        file: "p.lock",
        owner: "Painter",
        branch: "dashboard-3d-visual-painter",
        status: "done",
        claimed_at: "2026-11-01T16:00:00+01:00",
        released_at: "2026-11-01T17:00:00+01:00",
        commits: [],
        notes: "",
        worktree: null,
        raw: {},
      },
    });
    const row = detectLaneIdle(idle, NOW);
    assert.ok(row);
    assert.equal(row!.marker, "needs next task");

    const claimed = bot({
      id: "dashboard",
      name: "Dashboard",
      health: "healthy",
      lastActivityAt: "2026-11-01T17:55:00+01:00",
      lock: {
        file: "d.lock",
        owner: "Dashboard Bot",
        branch: "dashboard-3d",
        status: "claimed",
        claimed_at: "2026-11-01T17:50:00+01:00",
        released_at: null,
        commits: ["abc"],
        notes: "",
        worktree: null,
        raw: {},
      },
    });
    assert.equal(detectLaneIdle(claimed, NOW), null);
  });

  it("FAILS if DASHBOARD_QUEUE.md has no queued item (forever-contract)", () => {
    const candidates = [
      join(process.cwd(), ".handoff/DASHBOARD_QUEUE.md"),
      "/workspace/mind-command-os-dashboard/.handoff/DASHBOARD_QUEUE.md",
    ];
    const path = candidates.find((p) => existsSync(p));
    assert.ok(path, "DASHBOARD_QUEUE.md must exist");
    const items = parseDashboardQueueMarkdown(readFileSync(path!, "utf8"));
    const queued = items.filter((i) => i.status === "queued");
    assert.ok(
      queued.length >= 1,
      `Forever-contract breach: DASHBOARD_QUEUE.md has 0 queued items (found ${items.length} rows). Append researched upgrades.`,
    );
  });
});

describe("forever-contract hacker c20 — missing queue source is not a breach", () => {
  it("unavailable source ⇒ tone unknown, never red/green", () => {
    const g = buildForeverContractGuard({ queue: [], bots: [], nowMs: NOW, queueSource: "unavailable" });
    assert.equal(g.tone, "unknown");
    assert.equal(g.sourceAvailable, false);
    assert.match(g.label, /unavailable/i);
    assert.doesNotMatch(g.summary, /breach —/);
  });

  it("empty-string / null source also unknown; real empty file still red", () => {
    assert.equal(buildForeverContractGuard({ queue: [], nowMs: NOW, queueSource: "" }).tone, "unknown");
    assert.equal(buildForeverContractGuard({ queue: [], nowMs: NOW, queueSource: null }).tone, "unknown");
    assert.equal(
      buildForeverContractGuard({ queue: [], nowMs: NOW, queueSource: ".handoff/DASHBOARD_QUEUE.md" }).tone,
      "red",
    );
  });

  it("loadQueueFile: missing/oversized/dir candidates ⇒ unavailable, no throw, no path leak", async () => {
    const { loadQueueFile } = await import("./fleet-plan.ts");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "c20-queue-"));
    const huge = join(dir, "huge.md");
    writeFileSync(huge, "| 1 | **x** | queued | |\n".repeat(40_000));
    const r = loadQueueFile([join(dir, "nope.md"), huge, dir, "../../../../etc/passwd-not-md"]);
    assert.equal(r.source, "unavailable");
    assert.deepEqual(r.items, []);
    const ok = join(dir, "ok.md");
    writeFileSync(ok, "| 3 | **Real** | queued | |\n");
    const r2 = loadQueueFile([ok]);
    assert.equal(r2.items[0]?.status, "queued");
    assert.equal(r2.source.startsWith("/"), false);
  });
});
