import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_PALETTE_RESULTS,
  buildOperatorTargets,
  filterOperatorTargets,
  formatBotClipboardSummary,
  readOperatorPrefs,
  sanitizePaletteText,
  shouldIgnoreOperatorHotkey,
  writeOperatorPrefs,
} from "./operator-palette.ts";
import type { BotNode } from "./types.ts";

function bot(partial: Partial<BotNode> & Pick<BotNode, "id" | "name">): BotNode {
  return {
    id: partial.id,
    name: partial.name,
    health: partial.health ?? "healthy",
    lock: partial.lock ?? null,
    branch: partial.branch ?? null,
    lastActivityAt: null,
    commits: [],
    notes: "",
    reason: partial.reason ?? "",
  };
}

describe("operator-palette (hacker + queue #8)", () => {
  it("sanitizes XSS / HTML in names and clipboard", () => {
    const dirty = `<img src=x onerror=alert(1)><script>evil()</script>Logic Bot`;
    const clean = sanitizePaletteText(dirty);
    assert.ok(!clean.includes("<"));
    assert.ok(!clean.toLowerCase().includes("script"));
    assert.ok(!clean.toLowerCase().includes("onerror"));
    assert.match(clean, /Logic Bot/);

    const summary = formatBotClipboardSummary(
      bot({
        id: "logic",
        name: `<b>Logic</b>`,
        branch: "logic-wiring",
        lock: {
          file: "logic-wiring.lock",
          owner: "Logic",
          branch: "logic-wiring",
          status: "claimed",
          claimed_at: "t",
          released_at: null,
          commits: [],
          notes: "<script>x</script>",
          worktree: null,
          raw: { heartbeat_at: "t2" },
        },
      }),
    );
    assert.ok(!summary.includes("<"));
    assert.match(summary, /logic-wiring/);
  });

  it("ignores hotkeys while focus is in text inputs", () => {
    // minimal Element-like stubs
    const input = { tagName: "INPUT", isContentEditable: false, closest: () => null };
    const div = { tagName: "DIV", isContentEditable: false, closest: () => null };
    assert.equal(shouldIgnoreOperatorHotkey(input as unknown as EventTarget), true);
    assert.equal(shouldIgnoreOperatorHotkey(div as unknown as EventTarget), false);
    assert.equal(shouldIgnoreOperatorHotkey(null), false);
  });

  it("caps very large result lists and filters by query/health", () => {
    const bots = Array.from({ length: 200 }, (_, i) =>
      bot({
        id: `b${i}` as never,
        name: i % 2 === 0 ? `Alpha ${i}` : `Beta ${i}`,
        health: i % 3 === 0 ? "blocked" : "healthy",
      }),
    );
    const pages = Array.from({ length: 100 }, (_, i) => ({
      id: `p${i}`,
      title: `<i>Page ${i}</i>`,
      url: "",
      parentId: null,
      lastEdited: null,
      excerpt: "",
      kind: "page",
    }));
    const all = buildOperatorTargets({ bots, pages, buildings: [] });
    assert.ok(all.length > MAX_PALETTE_RESULTS);
    const filtered = filterOperatorTargets(all, "Alpha", 10_000);
    assert.ok(filtered.length <= MAX_PALETTE_RESULTS);
    assert.ok(filtered.every((t) => t.label.includes("Alpha")));
    assert.ok(filtered.every((t) => !t.label.includes("<")));

    const blockedOnly = buildOperatorTargets({ bots, healthFilter: "blocked" });
    assert.ok(blockedOnly.length > 0);
    assert.ok(blockedOnly.every((t) => t.health === "blocked"));
  });

  it("persists prefs without throwing", () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    writeOperatorPrefs(storage, {
      layers: { feed: false, charts: true, sound: false, labels: true, time: false },
      healthFilter: "stalled",
      lastNodeId: "bot:dashboard",
      lastNodeKind: "bot",
    });
    const prefs = readOperatorPrefs(storage);
    assert.equal(prefs.layers.feed, false);
    assert.equal(prefs.healthFilter, "stalled");
    assert.equal(prefs.lastNodeId, "bot:dashboard");
  });
});
