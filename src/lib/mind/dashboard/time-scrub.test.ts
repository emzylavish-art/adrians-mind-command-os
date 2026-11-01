import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_TIMELINE_EVENTS,
  applyScrubToBots,
  buildTimeline,
  formatWat,
  parseLockTransitionLog,
  scrubAt,
  scrubMsFromRatio,
} from "./time-scrub.ts";
import type { GitCommit, LockRecord } from "./types.ts";

const NOW = Date.parse("2026-11-01T17:00:00+01:00");

function commit(partial: Partial<GitCommit> & Pick<GitCommit, "sha" | "date" | "branch">): GitCommit {
  return {
    subject: partial.subject ?? "x",
    author: partial.author ?? "bot",
    sha: partial.sha,
    date: partial.date,
    branch: partial.branch,
  };
}

function lock(partial: Partial<LockRecord> & Pick<LockRecord, "file">): LockRecord {
  return {
    file: partial.file,
    owner: partial.owner ?? "",
    branch: partial.branch ?? null,
    status: partial.status ?? null,
    claimed_at: partial.claimed_at ?? null,
    released_at: partial.released_at ?? null,
    commits: partial.commits ?? [],
    notes: partial.notes ?? "",
    worktree: partial.worktree ?? null,
    raw: partial.raw ?? {},
  };
}

describe("time-scrub (hacker + queue #5)", () => {
  it("caps a 10k-commit flood and keeps the most recent window", () => {
    const commits: GitCommit[] = [];
    for (let i = 0; i < 10_000; i++) {
      const t = NOW - (10_000 - i) * 1000;
      commits.push(
        commit({
          sha: `sha${i}`,
          date: new Date(t).toISOString(),
          branch: "dashboard-3d",
          subject: `c${i}`,
        }),
      );
    }
    const tl = buildTimeline({ commits, nowMs: NOW, maxEvents: 500 });
    assert.equal(tl.events.length, 500);
    assert.equal(tl.truncated, true);
    assert.equal(tl.events[0]!.sha, "sha9500");
    assert.equal(tl.events[tl.events.length - 1]!.sha, "sha9999");
  });

  it("drops far-future lock timestamps (clock skew) and invalid dates", () => {
    const locks = [
      lock({
        file: "dashboard-3d.lock",
        claimed_at: "2026-11-01T16:00:00+01:00",
        released_at: "2099-01-01T00:00:00+01:00", // absurd future
        raw: { heartbeat_at: "not-a-date" },
      }),
      lock({
        file: "dashboard-3d-visual-light.lock",
        claimed_at: new Date(NOW + 60_000).toISOString(), // 1 min future — within skew → keep
        branch: "dashboard-3d-visual-light",
      }),
    ];
    const tl = buildTimeline({ locks, nowMs: NOW, maxFutureSkewMs: 5 * 60_000 });
    assert.ok(tl.droppedFuture >= 1);
    assert.ok(tl.droppedInvalid >= 1);
    assert.ok(tl.events.some((e) => e.kind === "lock_claim" && e.lockFile === "dashboard-3d.lock"));
    assert.ok(tl.events.some((e) => e.botId === "cosmos-light"));
    assert.ok(!tl.events.some((e) => e.atIso.includes("2099")));
  });

  it("scrub before earliest → no history before X; Live near now; no fake midpoints", () => {
    const commits = [
      commit({
        sha: "aaa1111",
        date: "2026-11-01T15:00:00+01:00",
        branch: "dashboard-3d",
        subject: "land sound",
      }),
      commit({
        sha: "bbb2222",
        date: "2026-11-01T16:00:00+01:00",
        branch: "dashboard-3d-visual-painter",
        subject: "paint",
      }),
    ];
    const locks = [
      lock({
        file: "dashboard-3d.lock",
        status: "claimed",
        claimed_at: "2026-11-01T15:30:00+01:00",
        raw: { heartbeat_at: "2026-11-01T15:45:00+01:00" },
        branch: "dashboard-3d",
      }),
    ];
    const tl = buildTimeline({ commits, locks, nowMs: NOW });
    assert.ok(tl.earliestMs != null);

    const before = scrubAt({
      timeline: tl,
      botIds: ["dashboard", "cosmos-painter", "cosmos-light"],
      scrubMs: tl.earliestMs! - 60_000,
      nowMs: NOW,
    });
    assert.equal(before.mode, "before_history");
    assert.match(before.message ?? "", /no history before/i);
    assert.equal(before.botHealth.dashboard?.health, "idle");
    assert.equal(before.botHealth["cosmos-light"]?.health, "idle");

    const mid = scrubAt({
      timeline: tl,
      botIds: ["dashboard", "cosmos-painter", "cosmos-light"],
      scrubMs: Date.parse("2026-11-01T15:40:00+01:00"),
      nowMs: NOW,
    });
    assert.equal(mid.mode, "scrub");
    // Claimed at 15:30; scrub 15:40 → recent claim counts as activity → healthy (not invented)
    assert.equal(mid.botHealth.dashboard?.health, "healthy");
    const afterHb = scrubAt({
      timeline: tl,
      botIds: ["dashboard", "cosmos-painter", "cosmos-light"],
      scrubMs: Date.parse("2026-11-01T15:46:00+01:00"),
      nowMs: NOW,
    });
    assert.equal(afterHb.botHealth.dashboard?.health, "healthy");
    // 35+ min after last heartbeat with no new events → stalled (real stall clock)
    const stalled = scrubAt({
      timeline: tl,
      botIds: ["dashboard", "cosmos-painter", "cosmos-light"],
      scrubMs: Date.parse("2026-11-01T16:25:00+01:00"),
      nowMs: NOW,
    });
    assert.equal(stalled.botHealth.dashboard?.health, "stalled");
    // painter commit lands at 16:00 — still idle at 15:46 (no invent); present at 16:25
    assert.equal(mid.botHealth["cosmos-painter"]?.health, "idle");
    assert.equal(afterHb.botHealth["cosmos-painter"]?.health, "idle");
    assert.notEqual(stalled.botHealth["cosmos-painter"]?.health, undefined);
    // light never appeared
    assert.equal(mid.botHealth["cosmos-light"]?.health, "idle");

    const live = scrubAt({
      timeline: tl,
      botIds: ["dashboard"],
      scrubMs: NOW,
      nowMs: NOW,
      liveHealth: { dashboard: { health: "stalled", reason: "live snap" } },
    });
    assert.equal(live.mode, "live");
    assert.equal(live.botHealth.dashboard?.health, "stalled");
  });

  it("parses transition log + applyScrubToBots + ratio helper", () => {
    const lines = parseLockTransitionLog(
      `# comment\n2026-11-01T17:46:37+01:00\treleased\tDashboard Bot\tc11 idle\n2026-11-01T17:46:37+01:00\tclaimed\tDashboard Bot\t#5\n`,
    );
    assert.equal(lines.length, 2);
    assert.equal(lines[0]!.action, "released");

    const tl = buildTimeline({
      transitions: lines,
      nowMs: NOW + 3600_000,
    });
    assert.ok(tl.events.length >= 2);

    const scrub = scrubAt({
      timeline: tl,
      botIds: ["dashboard"],
      scrubMs: Date.parse("2026-11-01T17:46:37+01:00"),
      nowMs: NOW + 3600_000,
    });
    const bots = applyScrubToBots(
      [{ id: "dashboard", health: "healthy" as const, reason: "live" }],
      scrub,
    );
    assert.ok(bots[0]!.health === "healthy" || bots[0]!.health === "idle" || bots[0]!.health === "stalled");

    assert.equal(scrubMsFromRatio({ ...tl, earliestMs: null, latestMs: null, events: [] }, 0.5, NOW), NOW);
    assert.ok(formatWat(NOW).includes("WAT"));
    assert.ok(MAX_TIMELINE_EVENTS >= 500);
  });
});
