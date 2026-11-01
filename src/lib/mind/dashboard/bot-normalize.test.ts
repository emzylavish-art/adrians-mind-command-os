import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeBotsById, sanitizeBotDisplayName, stripBidiControls } from "./bot-normalize.ts";
import type { BotNode } from "./types.ts";

function bot(p: Partial<BotNode> & { id: string; name: string }): BotNode {
  return {
    health: "healthy",
    lock: null,
    branch: null,
    lastActivityAt: null,
    commits: [],
    notes: "",
    reason: "",
    ...p,
  } as BotNode;
}

describe("bot-normalize (#18/#20)", () => {
  it("strips bidi overrides", () => {
    assert.equal(stripBidiControls("ab\u202Ecd"), "abcd");
    assert.ok(!sanitizeBotDisplayName("x".repeat(200)).includes("\u202E"));
    assert.equal(sanitizeBotDisplayName("x".repeat(200)).length, 160);
  });
  it("dedupes by id keeping newer activity", () => {
    const out = dedupeBotsById([
      bot({ id: "logic", name: "Logic", lastActivityAt: "2026-11-01T10:00:00.000Z" }),
      bot({ id: "logic", name: "Logic 2", lastActivityAt: "2026-11-01T12:00:00.000Z" }),
      bot({ id: "conductor", name: "Conductor" }),
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0]!.name, "Logic 2");
    assert.equal(out[1]!.id, "conductor");
  });
});
