import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addAgentFromTemplate, emptyFleet } from "../fleet.ts";
import { emptyWorkspace } from "../workspace.ts";
import { PERSONA_CATEGORIES } from "./categories.ts";
import {
  buildPersonaDirectory,
  emptyStateForCategory,
  filterPersonaDirectory,
} from "./directory.ts";

describe("persona directory", () => {
  it("lists every built-in template as non-live Official cards", () => {
    const directory = buildPersonaDirectory(emptyFleet());
    const templates = directory.cards.filter((card) => card.source === "template");
    assert.ok(templates.length >= 8);
    assert.equal(templates.every((card) => card.live === false && card.badge === "TEMPLATE"), true);
    assert.equal(directory.counts.official, templates.length);
    assert.ok(directory.counts.search >= 1);
    assert.ok(directory.counts.programming >= 1);
  });

  it("includes saved agents under My agents without inventing remote bots", () => {
    const made = addAgentFromTemplate(emptyWorkspace(), "Research", "2026-11-01T12:00:00.000+01:00");
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const directory = buildPersonaDirectory(made.ws);
    const saved = directory.cards.filter((card) => card.source === "saved");
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.name, "Research");
    assert.equal(saved[0]?.live, false);
    assert.equal(directory.counts.mine, 1);
    assert.match(JSON.stringify(directory.cards), /Research/);
    assert.equal(directory.cards.some((card) => /poe|character\.ai/i.test(card.name)), false);
  });

  it("filters by Search and shows an honest empty state for Video", () => {
    const directory = buildPersonaDirectory(emptyFleet());
    const search = filterPersonaDirectory(directory, { category: "search" });
    assert.ok(search.length >= 1);
    assert.equal(search.every((card) => card.roleCategory === "search"), true);
    const video = filterPersonaDirectory(directory, { category: "video" });
    assert.equal(video.length, 0);
    const empty = emptyStateForCategory("video", 0);
    assert.match(empty ?? "", /No local personas in Video/i);
  });

  it("exposes every evidence category id for the Explore shelf", () => {
    const ids = PERSONA_CATEGORIES.map((item) => item.id);
    for (const needed of ["official", "budget", "search", "image", "video", "audio", "programming", "assistant"]) {
      assert.ok(ids.includes(needed as (typeof ids)[number]), needed);
    }
  });
});
