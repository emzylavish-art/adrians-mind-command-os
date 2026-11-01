import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { phaseToUiAttr } from "./types.ts";

describe("badge mirrors live session attr", () => {
  it("maps connecting/listening/speaking phases for the header badge", () => {
    assert.equal(phaseToUiAttr("connecting", false), "connecting");
    assert.equal(phaseToUiAttr("listening", false), "listening");
    assert.equal(phaseToUiAttr("user_speaking", false), "user-speaking");
    assert.equal(phaseToUiAttr("assistant_speaking", false), "assistant-speaking");
    assert.equal(phaseToUiAttr("listening", true), "muted");
  });
});
