import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildViewUrlSearch, parseViewUrlSearch, sanitizeFocusId } from "./view-url.ts";

describe("view-url (#39 Gap#16)", () => {
  it("parses focus/level and rejects hostile ids", () => {
    const allowed = new Set(["logic", "conductor"]);
    assert.deepEqual(parseViewUrlSearch("?focus=logic&level=city", allowed), {
      focus: "logic",
      level: "city",
    });
    assert.equal(sanitizeFocusId("../x", allowed), null);
    assert.equal(sanitizeFocusId("unknown", allowed), null);
  });
  it("builds search omitting universe defaults", () => {
    assert.equal(buildViewUrlSearch({ focus: null, level: "universe" }), "");
    assert.equal(buildViewUrlSearch({ focus: "logic", level: "universe" }), "?focus=logic");
    assert.equal(buildViewUrlSearch({ focus: "logic", level: "city" }), "?focus=logic&level=city");
  });
});
