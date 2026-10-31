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
