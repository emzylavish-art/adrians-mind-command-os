import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeBotsById,
  sanitizeBotDisplayName,
  sanitizeBranchLabel,
  sanitizeHostileText,
  stripBidiControls,
} from "./bot-normalize.ts";
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

describe("bot-normalize Gap#30 hostile branch/notes", () => {
  it("strips HTML/script from branch and notes", () => {
    assert.equal(sanitizeBranchLabel('preview<script>alert(1)</script>').includes("<"), false);
    assert.equal(sanitizeHostileText("javascript:alert(1) hello").includes("javascript:"), false);
    const out = dedupeBotsById([
      bot({
        id: "logic",
        name: "Logic",
        branch: "feat/<b>bold</b>",
        notes: "javascript:alert(1) hello",
        lock: {
          file: "logic.lock",
          owner: "logic",
          branch: 'preview<script>alert(1)</script>',
          status: "claimed",
          claimed_at: null,
          released_at: null,
          commits: [],
          notes: "x <img src=x onerror=alert(1)> y",
          worktree: null,
          heartbeatAt: null,
          task: null,
          raw: {},
        },
      }),
    ]);
    const b = out[0]!;
    assert.equal(b.branch?.includes("<"), false);
    assert.equal(b.notes.includes("javascript:"), false);
    assert.equal(b.lock?.notes.includes("<"), false);
    assert.equal(b.lock?.branch?.includes("<"), false);
  });
});
