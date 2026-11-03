import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIntentCatalog } from "./catalog.ts";
import { clearIntentFrequency, recordIntentAcceptance } from "./frequency.ts";
import { rankIntents, topIntent } from "./ranker.ts";
import { resetIntentSourceBus, pushComposerText, pushVoiceChunk, getLastIntentSource } from "./source-bus.ts";
import { runPredictedIntent } from "./run.ts";
import type { FrequencyStore } from "./frequency.ts";

function memStore(seed: Record<string, string> = {}): FrequencyStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? data[key]! : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("intent ranker", () => {
  it("ranks exact and prefix matches above noise", () => {
    const catalog = buildIntentCatalog();
    const ranked = rankIntents("open memory", { catalog, storage: null, minScore: 0.1 });
    assert.ok(ranked.length >= 1);
    assert.match(ranked[0]!.label.toLowerCase(), /memory/);
    assert.ok(ranked[0]!.score > 0.5);
  });

  it("returns empty for blank queries", () => {
    assert.deepEqual(rankIntents("   ", { catalog: buildIntentCatalog(), storage: null }), []);
    assert.equal(topIntent("", { catalog: buildIntentCatalog(), storage: null }), null);
  });

  it("boosts frequently accepted intents", () => {
    const catalog = buildIntentCatalog().filter((row) => row.id.startsWith("view:"));
    const store = memStore();
    const target = catalog.find((row) => /settings/i.test(row.label)) ?? catalog[0]!;
    for (let i = 0; i < 8; i++) recordIntentAcceptance(target.id, store, 1_700_000_000_000);
    const boosted = rankIntents(target.label.split(" ").slice(-1)[0]!, {
      catalog,
      storage: store,
      now: 1_700_000_000_000,
      minScore: 0.05,
    });
    const plain = rankIntents(target.label.split(" ").slice(-1)[0]!, {
      catalog,
      storage: null,
      minScore: 0.05,
    });
    const boostedRow = boosted.find((row) => row.id === target.id);
    const plainRow = plain.find((row) => row.id === target.id);
    assert.ok(boostedRow && plainRow);
    assert.ok(boostedRow.score >= plainRow.score);
    clearIntentFrequency(store);
  });

  it("handles voice chunks through the source bus", () => {
    resetIntentSourceBus();
    pushComposerText("go to");
    pushVoiceChunk("go to dashboard");
    const last = getLastIntentSource();
    assert.equal(last.source, "voice");
    assert.equal(last.text, "go to dashboard");
    const top = topIntent(last.text, { catalog: buildIntentCatalog(), storage: null });
    assert.ok(top);
    assert.match(top.label.toLowerCase(), /dashboard|universe/);
  });

  it("replaces wrong guesses with a new top match", () => {
    const catalog = buildIntentCatalog();
    const first = topIntent("settings", { catalog, storage: null });
    const second = topIntent("start voice", { catalog, storage: null });
    assert.ok(first && second);
    assert.notEqual(first.id, second.id);
  });

  it("runs predicted actions through handlers", () => {
    const seen: string[] = [];
    const ok = runPredictedIntent(
      { action: { type: "view", view: "settings" } },
      { setView: (view) => seen.push(view) },
    );
    assert.equal(ok, true);
    assert.deepEqual(seen, ["settings"]);
  });
});
