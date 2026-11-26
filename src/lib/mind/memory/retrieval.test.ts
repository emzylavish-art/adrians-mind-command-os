import assert from "node:assert/strict";
import { test } from "node:test";
import { rankMemories, selectMemoryContext, type RetrievalNote } from "./relevant.ts";
import { memoryMaintenance, updateMemoryMetadata } from "./maintenance.ts";
import { addMemory, emptyWorkspace, normalizeWorkspace } from "../workspace.ts";

test("local concepts retrieve a paraphrase without making an embedding call", () => {
  const ranked = rankMemories([{ id: "unrelated", text: "Conference catering details" }, { id: "relevant", text: "The automobile requires a replacement battery" }], "Which car needs a battery?");
  assert.equal(ranked[0].item.id, "relevant");
  const conceptOnly = rankMemories([{ id: "car", text: "Automobile insurance" }], "vehicle");
  assert.ok(conceptOnly[0].score > 0);
});

test("short exact technical identifiers outrank generic long words", () => {
  const ranked = rankMemories([{ id: "generic", text: "Current information details explain more information" }, { id: "api", text: "PR 42 changes the UI and OS API" }], "Information about PR 42 UI");
  assert.equal(ranked[0].item.id, "api");
});

test("fifteen always-apply preferences do not exclude essential task evidence", () => {
  const notes = Array.from({ length: 15 }, (_, i) => ({ id: `preference-${i}`, text: `Owner preference ${i}: use concise language.`, alwaysApply: true }));
  const selected = selectMemoryContext([...notes, { id: "decision", text: "The release destination is Harbor workspace", alwaysApply: false }], "Where is the release destination?");
  assert.equal(selected.notes.length, 16); assert.ok(selected.notes.some((item) => item.id === "decision")); assert.equal(selected.receipt.excluded.length, 0);
});

test("allocation is deterministic and records every excluded candidate under bounded text budgets", () => {
  const notes = Array.from({ length: 18 }, (_, i) => ({ id: String(i), text: `${"release ".repeat(100)}${i}`, alwaysApply: i < 8 }));
  const first = selectMemoryContext(notes, "release", { maxChars: 2400, preferenceChars: 800 });
  assert.deepEqual(first, selectMemoryContext(notes, "release", { maxChars: 2400, preferenceChars: 800 }));
  assert.ok(first.receipt.characters <= 2400); assert.equal(first.notes.length + first.receipt.excluded.length, 18);
  assert.ok(first.notes.some((item) => !item.alwaysApply));
});

test("approved superseding decisions outrank historical facts with provenance retained", () => {
  const old: RetrievalNote = { id: "old", text: "Release day is Thursday", authority: "historical", updatedAt: "2026-11-01" };
  const current: RetrievalNote = { id: "new", text: "Release day is Friday", authority: "owner-approved", updatedAt: "2026-11-20", supersedesIds: ["old"], sourceRef: { documentId: "release-plan", section: "Decisions", quote: "Release day is Friday" } };
  const result = selectMemoryContext([old, current], "release day");
  assert.deepEqual(result.notes.map((item) => item.id), ["new"]); assert.deepEqual(result.receipt.excluded, [{ id: "old", reason: "superseded" }]);
  assert.equal(result.notes[0].sourceRef?.section, "Decisions");
});

test("maintenance finds scoped duplicates and due reviews without changing or deleting notes", () => {
  let ws = addMemory(emptyWorkspace(), { text: "Use plain language.", scope: "global", source: "owner", projectId: null, chatId: null });
  ws = addMemory(ws, { text: "Use plain language!", scope: "global", source: "owner", projectId: null, chatId: null });
  ws = addMemory(ws, { text: "Use plain language!", scope: "project", source: "owner", projectId: "other", chatId: null });
  const updated = updateMemoryMetadata(ws, ws.memories[1].id, { authority: "owner-approved", tags: ["Writing"], reviewAt: "2026-01-01", sourceRef: { url: "javascript:bad", documentId: "d", section: "Tone" } }, ws.memories[1].updatedAt);
  assert.equal(updated.ok, true); if (!updated.ok) return;
  const normalized = normalizeWorkspace(updated.ws);
  const report = memoryMaintenance(normalized.memories, Date.parse("2026-11-26"));
  assert.equal(report.duplicates.length, 1); assert.equal(report.duplicates[0].length, 2); assert.equal(report.dueReviewIds.length, 1);
  assert.equal(normalized.memories.length, 3); assert.equal(normalized.memories[1].sourceRef?.url, undefined); assert.equal(normalized.memories[1].authority, "owner-approved");
  assert.equal(updateMemoryMetadata(normalized, normalized.memories[1].id, { authority: "historical" }, "stale-version").ok, false);
});
