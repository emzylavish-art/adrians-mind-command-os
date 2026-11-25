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

test("visible destinations and exact title survive a crowded result list", () => {
  for (const [query, view] of [["Dashboard","dashboard"],["Plugins","connected"],["Speak","speak"],["Social","social"],["GPT Wrapper","gpt-wrapper"]]) {
    assert.equal(paletteHits({ ...empty, query })[0]?.view, view);
  }
  const chats = [{id:"exact",title:"Budget",messages:[{id:"1", content:"note"}, {id:"2",content:"later budget"}]}];
  const runs = Array.from({length:20}, (_, i) => ({id:String(i), goal:"budget report", state:"done"}));
  const hits = paletteHits({...empty, runs, chats, query:"budget"});
  assert.equal(hits[0]?.ref, "exact");
  assert.equal(hits[0]?.messageId, "2");
  assert.equal(hits[0]?.excerpt, "later budget");
  assert.equal(paletteHits({...empty, chats, query:"note later"}).length, 0);
});

test("an exact Intelligence thread is reachable ahead of exact-title task runs", () => {
  const runs = Array.from({ length: 25 }, (_, i) => ({ id: "run-" + i, goal: "Weekly", state: "done" }));
  const chats = [{ id: "thread-b", title: "Weekly", humanCode: true, messages: [{ id: "older", content: "Weekly with B" }, { id: "latest", content: "Other" }] }];
  const hits = paletteHits({ ...empty, runs, chats, query: "weekly" });
  assert.equal(hits[0].ref, "thread-b");
  assert.equal(hits[0].view, "code");
  assert.equal(hits[0].messageId, "older");
  assert.equal(hits.length, 26);
});
