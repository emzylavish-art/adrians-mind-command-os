import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyHealth, sanitizeLabelText, STALL_MS, textLooksBlocked } from "./health.ts";
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
          heartbeatAt: null,
          task: null,
    raw: {},
    ...partial,
  };
}

const NOW = Date.parse("2026-11-01T13:00:00+01:00");

describe("classifyHealth", () => {
  it("marks missing lock as idle", () => {
    assert.equal(classifyHealth({ lock: null, lastActivityAt: null, now: NOW }).health, "idle");
  });

  it("marks done/released as healthy", () => {
    assert.equal(
      classifyHealth({
        lock: lock({ status: "done, released", released_at: "2026-11-01T12:55:00+01:00" }),
        lastActivityAt: "2026-11-01T12:55:00+01:00",
        now: NOW,
      }).health,
      "healthy",
    );
  });

  it("marks claimed with recent activity as healthy", () => {
    const claimed = new Date(NOW - 5 * 60 * 1000).toISOString();
    assert.equal(
      classifyHealth({
        lock: lock({ status: "claimed", claimed_at: claimed }),
        lastActivityAt: claimed,
        now: NOW,
      }).health,
      "healthy",
    );
  });

  it("marks claimed with stale activity as stalled", () => {
    const claimed = new Date(NOW - STALL_MS - 60_000).toISOString();
    assert.equal(
      classifyHealth({
        lock: lock({ status: "claimed", claimed_at: claimed }),
        lastActivityAt: claimed,
        now: NOW,
      }).health,
      "stalled",
    );
  });

  it("marks active blocked status as blocked", () => {
    assert.equal(
      classifyHealth({
        lock: lock({ status: "blocked", claimed_at: new Date(NOW).toISOString() }),
        lastActivityAt: new Date(NOW).toISOString(),
        now: NOW,
      }).health,
      "blocked",
    );
  });

  it("does not flag red from notes that only mention BLOCKED/404/Unauthorized", () => {
    assert.equal(textLooksBlocked("claimed", "BLOCKED: cycle stopped by rate limits; safety-restart will resume."), false);
    assert.equal(
      classifyHealth({
        lock: lock({
          status: "claimed",
          claimed_at: new Date(NOW).toISOString(),
          notes: "Direct hang Unauthorized+WAV decode; Notion primary 404; not a failure banner.",
        }),
        lastActivityAt: new Date(NOW).toISOString(),
        now: NOW,
      }).health,
      "healthy",
    );
  });

  it("treats status blocked with released_at as stalled not active red", () => {
    const r = classifyHealth({
      lock: lock({
        status: "blocked",
        claimed_at: "2026-11-01T12:47:00+01:00",
        released_at: "2026-11-01T12:48:00+01:00",
        notes: "BLOCKED: cycle 2 worker stopped by request limits before changes landed.",
      }),
      lastActivityAt: "2026-11-01T12:48:00+01:00",
      now: NOW,
    });
    assert.equal(r.health, "stalled");
  });

  it("sanitizes label text for DOM/CSS2D", () => {
    assert.equal(sanitizeLabelText("Hi <script>alert(1)</script>\nBot"), "Hi scriptalert(1)/scriptBot");
  });
});
