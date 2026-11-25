import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextClock, zoneIsValid } from "./schedule-clock.ts";

describe("schedule clock", () => {
  it("picks the next 08:00 in a real time zone and rejects a fake zone name", () => {
    assert.equal(zoneIsValid("America/Chicago"), true);
    assert.equal(zoneIsValid("Not/AZone"), false);
    const next = nextClock("2026-04-01T12:00:00.000Z", "America/Chicago", 8, 0);
    assert.equal(next.zone, "America/Chicago");
    const when = new Date(next.at);
    const hour = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hourCycle: "h23", hour: "2-digit" }).format(when);
    assert.equal(hour, "08");
    assert.ok(when.getTime() > Date.parse("2026-04-01T12:00:00.000Z"));
    const fallback = nextClock("2026-04-01T12:00:00.000Z", "Not/AZone", 8, 0);
    assert.equal(fallback.zone, "UTC");
  });
});

it("aligns to the minute and runs once per local date on clock rollback", () => {
  assert.equal(nextClock("2026-04-01T12:59:58.123Z", "Africa/Lagos", 14, 0).at, "2026-04-01T13:00:00.000Z");
  assert.equal(nextClock("2026-11-01T05:30:00Z", "America/New_York", 1, 30, "2026-11-01T05:30:00Z").at, "2026-11-02T06:30:00.000Z");
});
