import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBufferKey, buildDiff, buildDraftKey, buildResultHandoff, normalizeBuildSelection, parseBuildDraft, serializeBuildDraft } from "./build-review.ts";

test("Build draft recovery preserves separate files and original save baselines per account", () => {
  const one = { workspace: "hosted", path: "one.ts", saved: "old", draft: "new" };
  const two = { workspace: "pc", cwd: "fixture", path: "two.ts", saved: "", draft: "unsaved" };
  const keys = [buildBufferKey(one, one.path), buildBufferKey(two, two.path)];
  const raw = serializeBuildDraft({ owner: "A", buffers: { [keys[0]]: one, [keys[1]]: two }, tabs: keys, selectedFile: keys[1], prompt: "Continue my work" });
  assert.deepEqual(parseBuildDraft(raw, "A")?.buffers, { [keys[0]]: one, [keys[1]]: two });
  assert.equal(parseBuildDraft(raw, "B"), null);
  assert.notEqual(buildDraftKey("A"), buildDraftKey("B"));
  assert.equal(parseBuildDraft(raw, "A")?.buffers[keys[0]].saved, "old");
});

test("Build diff shows deletions, reordered and repeated lines, and long edits", () => {
  assert.match(buildDiff("a", "validate\npermission\nsave", "validate\nsave"), /- permission/);
  const moved = buildDiff("a", "one\ntwo\none", "one\none\ntwo");
  assert.match(moved, /- two/); assert.match(moved, /\+ two/);
  assert.match(buildDiff("a", "a\na\na", "a\na"), /- a/);
  assert.match(buildDiff("a", "old", Array.from({ length: 25 }, (_, i) => `line${i}`).join("\n")), /\+ line24/);
});

test("Build handoff preserves every change and trailing verification failure", () => {
  const result = buildResultHandoff([{ path: "a", before: "guard", after: "" }, { path: "b", before: "", after: "test" }], "x".repeat(20_000) + "\nTEST FAILED", "op1");
  assert.match(result, /verification remains pending/); assert.match(result, /--- a/); assert.match(result, /--- b/);
  assert.ok(result.endsWith("TEST FAILED")); assert.match(result, /Operation: op1/);
});

test("Build recovery keeps cursor selection and large unsaved drafts without another account inheriting them", () => {
  const file = { workspace: "hosted", path: "long.txt", saved: "", draft: "x".repeat(1_100_000), selection: { anchor: 30, head: 45 } };
  const key = buildBufferKey(file, file.path);
  const raw = serializeBuildDraft({ owner: "owner-A", buffers: { [key]: file }, tabs: [key], selectedFile: key, prompt: "" });
  assert.equal(parseBuildDraft(raw, "owner-A")?.buffers[key]?.draft.length, 1_100_000);
  assert.deepEqual(parseBuildDraft(raw, "owner-A")?.buffers[key]?.selection, { anchor: 30, head: 45 });
  assert.equal(parseBuildDraft(raw, "owner-B"), null);
  assert.deepEqual(normalizeBuildSelection({ anchor: -5, head: 50 }, 10), { anchor: 0, head: 10 });
});

test("rename and empty creation/deletion remain visible, and failed requests never become completed handoffs", () => {
  assert.match(buildDiff("new.ts", "same", "same", "old.ts"), /rename from old.ts\nrename to new.ts/);
  assert.match(buildDiff("new.ts", "before", "after", "old.ts"), /--- old.ts\n\+\+\+ new.ts/);
  assert.match(buildDiff("empty", "", "", undefined, { beforeExists: false }), /new file empty/);
  assert.match(buildDiff("empty", "", "", undefined, { afterExists: false }), /deleted file empty/);
  const handoff = buildResultHandoff([{ path: "partial", before: "old", after: "new" }], "observed output", "op-failed", { completed: false, error: "Process closed", outputComplete: false });
  assert.match(handoff, /did not complete/); assert.match(handoff, /Process closed/); assert.match(handoff, /output is incomplete/); assert.doesNotMatch(handoff, /request completed/);
});
