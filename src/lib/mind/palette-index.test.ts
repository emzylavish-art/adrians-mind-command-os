import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { createPaletteIndexBuilder, queryPaletteIndex, type PaletteData } from "./palette.ts";

const empty = (): PaletteData => ({ projects: [], chats: [], memories: [], files: [], agents: [], runs: [] });

test("AA125 a large corpus reuses normalized message data across queries and unrelated collection changes", () => {
  let contentReads = 0;
  const expected: string[] = [];
  const data = empty();
  data.projects = [{ id: "p", name: "Harbor", description: "" }];
  data.chats = Array.from({ length: 120 }, (_, chatIndex) => ({
    id: `chat-${chatIndex}`, title: `Review ${chatIndex}`, projectId: "p",
    messages: Array.from({ length: 100 }, (_, messageIndex) => {
      const id = `message-${chatIndex}-${messageIndex}`;
      const matches = messageIndex % 37 === 0;
      if (matches) expected.push(id);
      return { id, get content() { contentReads++; return matches ? `Copper needle inspection ${chatIndex}:${messageIndex}` : `Routine maintenance ${chatIndex}:${messageIndex}`; } };
    }),
  }));
  const build = createPaletteIndexBuilder();
  const index = build(data);
  assert.equal(contentReads, 12_000);
  const initialReads = contentReads;
  for (const query of ["copper needle", '"copper needle"', "needle copper", "unmatched topic", "Harbor", ""]) {
    const hits = queryPaletteIndex(index, query);
    if (query.includes("copper")) assert.deepEqual(hits.map((hit) => hit.messageId).sort(), [...expected].sort());
    assert.equal(contentReads, initialReads, "a query must not reread or normalize source message bodies");
  }
  assert.equal(build({ ...data }), index, "same immutable collections reuse the index itself");
  const changedRun = build({ ...data, runs: [{ id: "run", goal: "Unrelated task", state: "queued" }] });
  assert.notEqual(changedRun, index);
  assert.equal(contentReads, initialReads, "run changes must not rebuild conversation bodies");
  const renamedProject = { ...data, projects: [{ ...data.projects[0]!, name: "New Harbor" }] };
  const contextChanged = build(renamedProject);
  assert.equal(contentReads, initialReads, "project-context updates reuse normalized bodies");
  assert.match(queryPaletteIndex(contextChanged, "copper needle")[0]!.meta, /New Harbor/);
  const changedMessage = { id: "message-0-0", get content() { contentReads++; return "Replacement marker"; } };
  const changedChat = { ...data.chats[0]!, messages: [changedMessage, ...data.chats[0]!.messages.slice(1)] };
  const changed = build({ ...renamedProject, chats: [changedChat, ...data.chats.slice(1)] });
  assert.equal(contentReads, initialReads + 1, "only the replaced message body is normalized again");
  assert.equal(queryPaletteIndex(changed, "copper needle").some((hit) => hit.messageId === changedMessage.id), false);
  assert.equal(queryPaletteIndex(changed, "replacement marker")[0]?.messageId, changedMessage.id);
});

test("AA120/121/122 indexed queries preserve phrases, independent terms, exact title priority and all message identities", () => {
  const data = empty();
  data.chats = [{ id: "exact", title: "Budget", messages: [
    { id: "first", content: "Budget allocation for copper needle" },
    { id: "second", content: "Budget: needle is copper" },
  ] }];
  data.runs = Array.from({ length: 25 }, (_, index) => ({ id: `run-${index}`, goal: "Budget", state: "done" }));
  const index = createPaletteIndexBuilder()(data);
  const budget = queryPaletteIndex(index, "budget");
  assert.equal(budget.length, 27); // two distinct messages and 25 runs, no duplicate title-only row
  assert.equal(budget[0]?.messageId, "first");
  assert.equal(budget[0]?.ref, "exact");
  assert.deepEqual(budget.filter((hit) => hit.ref === "exact").map((hit) => hit.messageId).sort(), ["first", "second"]);
  assert.deepEqual(queryPaletteIndex(index, '"copper needle"').map((hit) => hit.messageId), ["first"]);
  assert.deepEqual(queryPaletteIndex(index, "needle copper").map((hit) => hit.messageId).sort(), ["first", "second"]);
});

test("AA125 the actual CommandApp memo boundary reuses its index when only the query changes", () => {
  const source = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  const buildPaletteIndex = useMemo");
  const end = source.indexOf("\n  type ChromeMenu", start);
  assert.ok(start >= 0 && end > start);
  const compiled = stripTypeScriptTypes(`function render() { ${source.slice(start, end)}; return { hits, paletteIndex: paletteSearchIndex }; }`);
  const slots: Array<{ deps: unknown[]; value: unknown }> = [];
  let cursor = 0, builds = 0;
  const ws = empty();
  ws.chats = [{ id: "chat", title: "Review", messages: [{ id: "one", content: "Copper needle" }] }];
  const context: any = { ws, draftOwner: "fixture", paletteSkills: [], researchHistory: [], paletteFilter: "all", paletteOpen: true, deferredQuery: "copper", shownChatTitle: (chat: { title: string }) => chat.title, isIntelligenceThread: () => false,
    queryPaletteIndex,
    createPaletteIndexBuilder: () => { const build = createPaletteIndexBuilder(); return (input: PaletteData) => { builds++; return build(input); }; },
    useMemo(factory: () => unknown, deps: unknown[]) {
      const slot = cursor++;
      if (!slots[slot] || deps.some((value, index) => slots[slot]!.deps[index] !== value)) slots[slot] = { deps, value: factory() };
      return slots[slot]!.value;
    },
  };
  runInNewContext(compiled, context);
  const render = () => { cursor = 0; return context.render(); };
  const first = render();
  assert.equal(first.hits[0]?.messageId, "one");
  context.deferredQuery = "needle";
  const second = render();
  assert.equal(second.paletteIndex, first.paletteIndex);
  assert.equal(builds, 1);
  context.ws = { ...ws, runs: [{ id: "run", goal: "Needle check", state: "queued" }] };
  const changed = render();
  assert.notEqual(changed.paletteIndex, first.paletteIndex);
  assert.equal(builds, 2);
  assert.ok(changed.hits.some((hit: { ref: string }) => hit.ref === "run"));
});
