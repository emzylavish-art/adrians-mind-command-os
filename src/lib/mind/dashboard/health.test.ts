import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyHealth, STALL_MS } from "./health.ts";
import type { LockRecord } from "./types.ts";

function lock(partial: Partial<LockRecord>): LockRecord {
  return {
    file: "x.lock",
    owner: "Test Bot",
    branch: "test",
    status: null,
    claimed_at: null,
    released_at: null,
    commits: [],
    notes: "",
    worktree: null,
    raw: {},
    ...partial,
  };
}

const NOW = Date.parse("2026-11-01T13:00:00+01:00");

describe("classifyHealth", () => {
  it("marks missing lock as idle", () => {
    const r = classifyHealth({ lock: null, lastActivityAt: null, now: NOW });
    assert.equal(r.health, "idle");
  });

  it("marks done/released as healthy", () => {
    const r = classifyHealth({
      lock: lock({ status: "done, released", released_at: "2026-11-01T12:55:00+01:00" }),
      lastActivityAt: "2026-11-01T12:55:00+01:00",
      now: NOW,
    });
    assert.equal(r.health, "healthy");
  });

  it("marks claimed with recent activity as healthy", () => {
    const claimed = new Date(NOW - 5 * 60 * 1000).toISOString();
    const r = classifyHealth({
      lock: lock({ status: "claimed", claimed_at: claimed }),
      lastActivityAt: claimed,
      now: NOW,
    });
    assert.equal(r.health, "healthy");
  });

  it("marks claimed with stale activity as stalled", () => {
    const claimed = new Date(NOW - STALL_MS - 60_000).toISOString();
    const r = classifyHealth({
      lock: lock({ status: "claimed", claimed_at: claimed }),
      lastActivityAt: claimed,
      now: NOW,
    });
    assert.equal(r.health, "stalled");
  });

  it("marks blocked status/notes as blocked", () => {
    const a = classifyHealth({
      lock: lock({ status: "blocked", claimed_at: new Date(NOW).toISOString() }),
      lastActivityAt: new Date(NOW).toISOString(),
      now: NOW,
    });
    assert.equal(a.health, "blocked");

    const b = classifyHealth({
      lock: lock({
        status: "claimed",
        claimed_at: new Date(NOW).toISOString(),
        notes: "Lane blocked waiting on unauthorized API",
      }),
      lastActivityAt: new Date(NOW).toISOString(),
      now: NOW,
    });
    assert.equal(b.health, "blocked");

    const c = classifyHealth({
      lock: lock({
        status: "claimed",
        claimed_at: new Date(NOW).toISOString(),
        notes: "Direct hang Unauthorized+WAV decode fixed; diagnosis complete.",
      }),
      lastActivityAt: new Date(NOW).toISOString(),
      now: NOW,
    });
    assert.equal(c.health, "healthy");
  });
});
