import assert from "node:assert/strict";
import test from "node:test";
import { paletteHits } from "./palette.ts";

const empty = { projects: [], chats: [], memories: [], files: [], agents: [], runs: [] };

test("search shows Intelligence and still finds the old name", () => {
  const open = paletteHits({ query: "", ...empty });
  assert.equal(open.some((hit) => hit.label === "Intelligence" && hit.view === "code"), true);
  assert.equal(open.some((hit) => hit.label === "Human Code"), false);
  const old = paletteHits({ query: "human code", ...empty });
  assert.equal(old.some((hit) => hit.label === "Intelligence" && hit.view === "code"), true);
  const thread = paletteHits({
    query: "notes",
    ...empty,
    chats: [{ id: "c1", title: "Pier notes", messages: [{ content: "notes" }], humanCode: true }],
  });
  assert.equal(thread.some((hit) => hit.meta === "Intelligence"), true);
  assert.equal(thread.some((hit) => hit.meta === "Human Code"), false);
});
