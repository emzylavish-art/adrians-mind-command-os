import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { saveFailureMessage } from "./use-mind-workspace.ts";

describe("save failure messaging", () => {
  it("returns null when save succeeded", () => {
    assert.equal(saveFailureMessage({ ok: true }), null);
  });

  it("keeps an explicit error and preserves content by not inventing a wipe", () => {
    const msg = saveFailureMessage({ ok: false, error: "The server copy could not be saved. The browser copy was kept." });
    assert.match(msg ?? "", /browser copy was kept/i);
  });

  it("falls back to the honest default when error text is missing", () => {
    const msg = saveFailureMessage({ ok: false });
    assert.match(msg ?? "", /could not be saved/i);
  });
});
