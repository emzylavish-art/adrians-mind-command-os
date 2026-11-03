import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cullLabelIds } from "./label-cull.ts";

describe("label cull", () => {
  it("hides the lower-priority box when two labels overlap", () => {
    const hide = cullLabelIds(
      [
        { id: "idle", priority: 3, left: 0, top: 0, right: 40, bottom: 16 },
        { id: "blocked", priority: 0, left: 10, top: 4, right: 50, bottom: 20 },
      ],
      { zoomedOut: false, viewportHeight: 800 },
    );
    assert.deepEqual(hide, ["idle"]);
  });

  it("hides bottom-row labels when the camera is zoomed out", () => {
    const hide = cullLabelIds(
      [{ id: "low", priority: 1, left: 0, top: 700, right: 40, bottom: 716 }],
      { zoomedOut: true, viewportHeight: 800, bottomFraction: 0.22 },
    );
    assert.deepEqual(hide, ["low"]);
  });
});
