import assert from "node:assert/strict";
import { test } from "node:test";
import { createDraft, emptyLibrary, latestVersion, loadLibrary, reviewDraft, reviseDraft, serializeLibrary, suggestCuration } from "./skill-library.ts";

const content = { title: "Weekly review", summary: "Review", body: "Read and list work; this is inert text." };

test("draft library round-trips and remains separate from executable skills", () => {
  const draft = createDraft(emptyLibrary(), content);
  const loaded = loadLibrary(serializeLibrary(draft));
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.deepEqual(loaded.library, draft);
  assert.equal(loaded.library.drafts[0]?.versions[0]?.status, "draft");
});

test("review is an immutable reviewed-inactive version; edits append", () => {
  const initial = createDraft(emptyLibrary(), content);
  const reviewed = reviewDraft(initial, "draft-1");
  const revised = reviseDraft(reviewed, "draft-1", { ...content, body: "Changed" });
  assert.equal(initial.drafts[0]?.versions.length, 1);
  assert.equal(reviewed.drafts[0]?.versions.length, 2);
  assert.equal(reviewed.drafts[0]?.versions[1]?.status, "reviewed-inactive");
  assert.equal(revised.drafts[0]?.versions.length, 3);
  assert.equal(latestVersion(revised.drafts[0]!).content.body, "Changed");
  assert.equal(initial.drafts[0]?.versions[0]?.content.body, content.body);
});

test("invalid or oversized stored content fails closed", () => {
  assert.equal(loadLibrary("{").ok, false);
  assert.equal(loadLibrary(JSON.stringify({ schemaVersion: 2, drafts: [] })).ok, false);
  assert.equal(loadLibrary("x".repeat(1_000_001)).ok, false);
  assert.throws(() => createDraft(emptyLibrary(), { ...content, title: "" }));
  const duplicate = { schemaVersion: 1, drafts: [
    { id: "draft-1", versions: [{ version: 1, status: "draft", content }] },
    { id: "draft-1", versions: [{ version: 1, status: "draft", content }] },
  ] };
  assert.equal(loadLibrary(JSON.stringify(duplicate)).ok, false);
  const changedReview = { schemaVersion: 1, drafts: [{ id: "draft-1", versions: [
    { version: 1, status: "draft", content },
    { version: 2, status: "reviewed-inactive", content: { ...content, body: "changed" } },
  ] }] };
  assert.equal(loadLibrary(JSON.stringify(changedReview)).ok, false);
  const gap = { schemaVersion: 1, drafts: [{ id: "draft-1", versions: [
    { version: 2, status: "draft", content },
  ] }] };
  assert.equal(loadLibrary(JSON.stringify(gap)).ok, false);
  assert.equal(loadLibrary(JSON.stringify({ schemaVersion: 1, drafts: [], extra: true })).ok, false);
});

test("curation returns deterministic suggestions without mutating drafts", () => {
  const draft = createDraft(emptyLibrary(), content);
  const before = serializeLibrary(draft);
  assert.deepEqual(suggestCuration(draft), suggestCuration(draft));
  assert.equal(serializeLibrary(draft), before);
  assert.equal(draft.drafts[0]?.versions[0]?.status, "draft");
});
