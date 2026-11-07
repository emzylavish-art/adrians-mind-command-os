import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paletteKeyAction } from "./palette-keys.ts";

describe("palette keyboard", () => {
  it("leaves arrow keys alone while the list is closed", () => {
    assert.deepEqual(paletteKeyAction({ key: "ArrowDown", open: false, count: 4, index: 0 }), { type: "none" });
  });

  it("moves through matches and wraps", () => {
    assert.deepEqual(paletteKeyAction({ key: "ArrowDown", open: true, count: 3, index: 2 }), { type: "move", index: 0 });
    assert.deepEqual(paletteKeyAction({ key: "ArrowUp", open: true, count: 3, index: 0 }), { type: "move", index: 2 });
    assert.deepEqual(paletteKeyAction({ key: "Home", open: true, count: 3, index: 2 }), { type: "move", index: 0 });
    assert.deepEqual(paletteKeyAction({ key: "End", open: true, count: 3, index: 0 }), { type: "move", index: 2 });
  });

  it("chooses the highlighted match on Enter and does not choose when modified", () => {
    assert.deepEqual(paletteKeyAction({ key: "Enter", open: true, count: 3, index: 1 }), { type: "choose", index: 1 });
    assert.deepEqual(
      paletteKeyAction({ key: "Enter", open: true, count: 3, index: 1, metaKey: true }),
      { type: "none" },
    );
  });

  it("closes on Escape and ignores movement when there are no matches", () => {
    assert.deepEqual(paletteKeyAction({ key: "Escape", open: true, count: 0, index: 0 }), { type: "close" });
    assert.deepEqual(paletteKeyAction({ key: "Enter", open: true, count: 0, index: 0 }), { type: "none" });
    assert.deepEqual(paletteKeyAction({ key: "ArrowDown", open: true, count: 0, index: 0 }), { type: "none" });
  });

  it("clamps a stale highlight before moving or choosing", () => {
    assert.deepEqual(paletteKeyAction({ key: "Enter", open: true, count: 2, index: 9 }), { type: "choose", index: 1 });
    assert.deepEqual(paletteKeyAction({ key: "ArrowDown", open: true, count: 2, index: -4 }), { type: "move", index: 1 });
  });
});
