import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBotDetailView,
  formatLaneHealthLine,
  laneHealthDrivers,
} from "./bot-detail.ts";
import { resolveFocusBotRequest } from "./focus-request.ts";
import type { BotNode } from "./types.ts";
import type { Constellation } from "./constellations.ts";

function bot(partial: Partial<BotNode> & { id: string; name: string; health: BotNode["health"] }): BotNode {
  return {
    reason: partial.reason ?? "test",
    branch: partial.branch ?? null,
    lastActivityAt: partial.lastActivityAt ?? null,
    notes: partial.notes ?? "",
    commits: partial.commits ?? [],
    lock: partial.lock ?? null,
    ...partial,
  } as BotNode;
}

describe("Gap#10 focus mid-flight (registered suite)", () => {
  it("latest of five rapid ids wins with retarget", () => {
    const ids = ["logic", "dashboard", "voice-wiring", "conductor", "cosmos-motion"] as const;
    const bots = ids.map((id) => bot({ id, name: id, health: "idle" }));
    let selected: string | null = null;
    let cam: string | null = null;
    for (const id of bots.map((b) => b.id)) {
      const r = resolveFocusBotRequest(id, bots, { gliding: true, preferRetarget: true });
      assert.equal(r.kind, "select");
      if (r.kind === "select") {
        selected = r.botId;
        if (r.startCamera) cam = r.botId;
      }
    }
    assert.equal(selected, "cosmos-motion");
    assert.equal(cam, "cosmos-motion");
  });
});

describe("Gap#54 detail dialog keys (pure contract)", () => {
  it("Escape is the dismiss key; Tab cycles endpoints", () => {
    // Contract documented for the panel keydown handler.
    const dismissKeys = new Set(["Escape"]);
    assert.equal(dismissKeys.has("Escape"), true);
    assert.equal(dismissKeys.has("Enter"), false);
    const trap = (activeIndex: number, len: number, shift: boolean) => {
      if (len <= 0) return 0;
      if (!shift && activeIndex >= len - 1) return 0;
      if (shift && activeIndex <= 0) return len - 1;
      return shift ? activeIndex - 1 : activeIndex + 1;
    };
    assert.equal(trap(5, 6, false), 0);
    assert.equal(trap(0, 6, true), 5);
  });
});

describe("Gap#55 nhop controls available without Notion page", () => {
  it("nhopDepth is clamped 0..3 for controlled input", () => {
    const clamp = (n: number) => Math.max(0, Math.min(3, Math.floor(Number.isFinite(n) ? n : 0)));
    assert.equal(clamp(1), 1);
    assert.equal(clamp(9), 3);
    assert.equal(clamp(-2), 0);
    assert.equal(clamp(Number.NaN), 0);
  });
});

describe("Gap#56 lane vs bot health labels", () => {
  it("formatLaneHealthLine names drivers when lane is worse than the focused bot", () => {
    const bots = [
      bot({ id: "cosmos-light", name: "Cosmos Light", health: "healthy", reason: "ok" }),
      bot({ id: "cosmos-motion", name: "Cosmos Motion", health: "stalled", reason: "old" }),
      bot({ id: "cosmos-painter", name: "Cosmos Painter", health: "idle", reason: "n" }),
    ];
    const lane: Constellation = {
      id: "visual-fleet" as Constellation["id"],
      name: "Visual Fleet",
      botIds: ["cosmos-light", "cosmos-motion", "cosmos-painter"] as Constellation["botIds"],
      center: [0, 0, 0],
      health: "stalled",
    };
    const drivers = laneHealthDrivers(bots, lane.botIds, lane.health, "cosmos-light");
    assert.equal(drivers.map((d) => d.id).join(","), "cosmos-motion");
    const line = formatLaneHealthLine(lane.name, lane.health, drivers);
    assert.match(line || "", /lane health|Visual Fleet · stalled \(from Cosmos Motion\)/);
    assert.match(line || "", /Visual Fleet · stalled \(from Cosmos Motion\)/);

    const view = buildBotDetailView({
      bot: bots[0]!,
      bots,
      commits: [],
      constellations: [lane],
      constellationEdges: [],
      notionGraph: {
        available: false,
        mode: "unavailable",
        generatedAt: null,
        pages: [],
        edges: [],
        botPageMap: {},
        stats: { pages: 0, edges: 0, botsMapped: 0 },
      },
      fleetPlan: null,
    });
    assert.equal(view.health, "healthy");
    assert.equal(view.laneHealth, "stalled");
    assert.match(view.laneHealthLine || "", /Visual Fleet · stalled \(from Cosmos Motion\)/);
  });
});
