import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { africaLagosHour } from "./wat-clock.ts";

describe("Africa/Lagos wall clock", () => {
  it("uses WAT rather than the server host timezone", () => {
    assert.equal(africaLagosHour(new Date("2026-11-05T00:30:00.000Z")), 1);
    assert.equal(africaLagosHour(new Date("2026-11-05T23:30:00.000Z")), 0);
  });
});
