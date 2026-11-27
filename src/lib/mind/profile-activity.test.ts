import test from "node:test";
import assert from "node:assert/strict";
import { profileActivity } from "./profile-activity.ts";
import type { UsageEntry } from "./types.ts";

test("profile keeps missing usage explicit; daily and weekly totals agree across year boundary", () => {
  const usage = ["2025-12-31", "2026-01-01", "2026-01-02"].map((day, i) => ({
    id: day, at: day + "T23:12:00Z", model: "model", requestId: null, chatId: "chat", promptTokens: i === 2 ? null : 5, completionTokens: 3, kind: "partial",
  } as UsageEntry));
  const input = { usage, runs: [] };
  const daily = profileActivity(input, "Daily", Date.parse("2026-01-03"));
  assert.equal(daily.knownTokens, 19);
  assert.equal(daily.missing, 1);
  assert.equal(daily.peak, 8);
  assert.equal(daily.currentStreak, 3);
  assert.equal(daily.longestRunMs, null);
  const weekly = profileActivity(input, "Weekly", Date.parse("2026-01-03"));
  assert.equal(weekly.buckets.length, 12);
  assert.equal(weekly.buckets.reduce((n, row) => n + row.known, 0), 19);
  assert.equal(profileActivity(input, "Cumulative", Date.parse("2026-01-05")).currentStreak, 0);
});
