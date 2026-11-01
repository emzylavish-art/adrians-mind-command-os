import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { greeting } from "./greeting.ts";

describe("greeting", () => {
  it("does not call the middle of the night morning", () => {
    assert.equal(greeting(new Date("2026-11-01T00:37:00")), "Good night");
    assert.equal(greeting(new Date("2026-11-01T09:00:00")), "Good morning");
    assert.equal(greeting(new Date("2026-11-01T13:00:00")), "Good afternoon");
    assert.equal(greeting(new Date("2026-11-01T20:37:00")), "Good evening");
  });
});
