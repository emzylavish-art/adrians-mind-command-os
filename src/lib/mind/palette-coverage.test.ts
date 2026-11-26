import assert from "node:assert/strict";
import test from "node:test";
import { paletteHits, searchScore, type PaletteInput } from "./palette.ts";
const blank: PaletteInput = { query: "release", projects: [], chats: [], memories: [], files: [], agents: [], runs: [] };
test("search returns each matching message with a stable destination", () => {
  const rows = paletteHits({ ...blank, chats: [{ id: "c", title: "Build", messages: [{ id: "m1", content: "release one", at: "2026-01-01" }, { id: "m2", content: "second release", at: "2026-01-02" }] }] });
  assert.equal(rows.length, 2); assert.deepEqual(new Set(rows.map((row) => row.messageId)), new Set(["m1", "m2"])); assert.equal(new Set(rows.map((row) => row.key)).size, 2); assert.equal(rows[0].messageId, "m2");
});
test("search normalizes accents and matches multiple words in any order", () => {
  assert.ok(searchScore("Résumé API", "", "api resume") > 0); assert.equal(searchScore("API", "", "api release"), 0); assert.ok(searchScore("release", "", "release") > searchScore("unrelated", "release", "release"));
});
test("schedules, research, activity, connections and skills have distinct targets and filters", () => {
  const input = { ...blank, schedules: [{ id: "s", goal: "release", enabled: false }], research: [{ id: "r", question: "release", summary: "data" }], activity: [{ id: "a", action: "release", target: "code", result: "saved" }], connections: [{ id: "p", label: "release" }], skills: [{ id: "k", name: "release" }] };
  assert.equal(paletteHits(input).length, 5); const filtered = paletteHits({ ...input, filter: "research" }); assert.equal(filtered.length, 1); assert.equal(filtered[0].ref, "r");
});
