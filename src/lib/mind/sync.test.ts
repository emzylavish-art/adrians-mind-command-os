import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseServerSync } from "./sync.ts";

describe("browser and server copies", () => {
  it("does not discard either copy when both already exist", () => {
    assert.equal(chooseServerSync(true, true), "keep-local");
  });

  it("uploads only when the server is empty and loads the server only when the browser is empty", () => {
    assert.equal(chooseServerSync(true, false), "upload-local");
    assert.equal(chooseServerSync(false, true), "use-server");
    assert.equal(chooseServerSync(false, false), "empty");
  });
});
