import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hudDefaultOpen, sortHudCards } from "./hud-order.ts";

describe("hud card order", () => {
  it("puts needs-you before status and charts last", () => {
    const ordered = sortHudCards([
      { id: "charts", band: "charts" as const, seq: 0 },
      { id: "weather", band: "status" as const, seq: 1 },
      { id: "money", band: "needs" as const, seq: 2 },
      { id: "notion", band: "needs" as const, seq: 0 },
    ]);
    assert.deepEqual(ordered.map((item) => item.id), ["notion", "money", "weather", "charts"]);
  });

  it("keeps supporting cards collapsed until deliberately opened", () => {
    assert.equal(hudDefaultOpen(0), false);
    assert.equal(hudDefaultOpen(1), false);
    assert.equal(hudDefaultOpen(2), false);
  });
});
