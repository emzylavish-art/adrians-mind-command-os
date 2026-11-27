import assert from "node:assert/strict";
import { test } from "node:test";
import { clearLocalRetention, verifyDeletionAcknowledgement } from "./data-retention.ts";
import { accountPreferenceKey } from "./account-preferences.ts";
import { researchArchiveKey } from "./research-reports.ts";
import { emptyWorkspace } from "./workspace.ts";

function storage(entries: [string, string][]) { const rows = new Map(entries); return { rows, get length() { return rows.size; }, getItem: (key: string) => rows.get(key) ?? null, key: (index: number) => [...rows.keys()][index] ?? null, removeItem: (key: string) => { rows.delete(key); } }; }

test("local removal affects only selected categories and the exact owner namespace", async () => {
  const local = storage([[researchArchiveKey("owner"), "own research"], [researchArchiveKey("other"), "other research"], [accountPreferenceKey("owner", "voice"), "own preferences"], [accountPreferenceKey("other", "voice"), "other preferences"], ["amcos.workspace.v1.u.owner", "saved chats"]]);
  const session = storage([]); const cleared: string[] = [];
  const result = await clearLocalRetention("owner", ["research", "preferences"], { local, session, originals: { clear: async () => { cleared.push("originals"); } }, images: { clear: async () => { cleared.push("images"); } }, videos: { clear: async () => { cleared.push("videos"); } }, knowledge: { clear: async () => { cleared.push("knowledge"); } } });
  assert.equal(result.length, 2); assert.ok(result.every((receipt) => receipt.state === "locally-cleared"));
  assert.equal(local.getItem(researchArchiveKey("owner")), null); assert.equal(local.getItem(researchArchiveKey("other")), "other research");
  assert.equal(local.getItem(accountPreferenceKey("other", "voice")), "other preferences"); assert.equal(local.getItem("amcos.workspace.v1.u.owner"), "saved chats"); assert.deepEqual(cleared, []);
});

test("partial local failures remain failures while independent selected removals finish", async () => {
  const result = await clearLocalRetention("owner", ["originals", "knowledge"], { local: storage([]), session: storage([]), originals: { clear: async () => { throw Error("quota"); } }, images: { clear: async () => {} }, videos: { clear: async () => {} }, knowledge: { clear: async () => {} } });
  assert.deepEqual(result.map((receipt) => receipt.state), ["failed", "locally-cleared"]);
  assert.ok(result.every((receipt) => !receipt.detail.includes("server deleted")));
});

test("build recovery removal retains files and other account recovery pointers", async () => {
  const local = storage([["amcos.build-editor.v1.owner", "draft"], ["amcos.build-result.v1.owner", "result"], ["adrian-build-last-job.owner", "job"], ["adrian-build-last-job.other", "other"], ["saved-file", "code"]]);
  const session = storage([["adrian-build-draft.owner", "prompt"], ["adrian-build-draft.other", "other"]]);
  await clearLocalRetention("owner", ["build-recovery"], { local, session, originals: { clear: async () => {} }, images: { clear: async () => {} }, videos: { clear: async () => {} }, knowledge: { clear: async () => {} } });
  assert.equal(local.getItem("amcos.build-editor.v1.owner"), null); assert.equal(local.getItem("adrian-build-last-job.other"), "other"); assert.equal(local.getItem("saved-file"), "code"); assert.equal(session.getItem("adrian-build-draft.other"), "other");
});

test("server deletion confirmation requires both the tombstone and absent resource", () => {
  const local = { ...emptyWorkspace(), deletedChatIds: ["one", "two"], deletedMemoryIds: ["note"] };
  const server = { ...emptyWorkspace(), deletedChatIds: ["one"], deletedMemoryIds: ["note"] };
  const result = verifyDeletionAcknowledgement(local, server);
  assert.deepEqual(result.confirmedChatIds, ["one"]); assert.deepEqual(result.pendingChatIds, ["two"]); assert.deepEqual(result.confirmedMemoryIds, ["note"]);
  assert.match(result.scope, /Offline devices.*not verified/);
  assert.equal(verifyDeletionAcknowledgement(local, null).confirmedChatIds.length, 0);
});

test("explicit video-copy removal retains recovery metadata and reports a blocked local store truthfully", async () => {
  const local = storage([[accountPreferenceKey("owner", "amcos.video-jobs.v1"), "recoverable job"]]);
  const cleared: string[] = [];
  const deps = { local, session: storage([]), originals: { clear: async () => { cleared.push("originals"); } }, images: { clear: async () => { cleared.push("images"); } }, knowledge: { clear: async () => { cleared.push("knowledge"); } }, videos: { clear: async () => { cleared.push("videos"); } } };
  const success = await clearLocalRetention("owner", ["videos"], deps);
  assert.deepEqual(cleared, ["videos"]);
  assert.equal(success[0]?.state, "locally-cleared");
  assert.match(success[0]?.detail ?? "", /server recovery records.*remain/);
  assert.equal(local.getItem(accountPreferenceKey("owner", "amcos.video-jobs.v1")), "recoverable job");
  const blocked = await clearLocalRetention("owner", ["videos"], { ...deps, videos: { clear: async () => { throw new Error("Another tab holds this database"); } } });
  assert.equal(blocked[0]?.state, "failed");
  assert.match(blocked[0]?.detail ?? "", /did not acknowledge complete removal/);
});
