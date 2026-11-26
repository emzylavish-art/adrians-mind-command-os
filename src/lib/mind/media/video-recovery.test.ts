import assert from "node:assert/strict";
import { test } from "node:test";
import { startVideoJob, pollVideoJob, videoRetentionLabel, type VideoJob, type VideoJobStore } from "./video-jobs.ts";
import { beginRecoverableVideo, pollRecoverableVideo, readVideoRecovery, mergeVideoRecovery } from "./video-recovery.ts";
import { DEFAULT_VIDEO_SETTINGS, validateVideoSettings } from "./video-settings.ts";
import { verifyDeviceVideoCopy } from "./video-device-store.ts";
import { downloadOwnedVideo } from "./video-download.server.ts";

const operationId = "11111111-1111-4111-8111-111111111111";
function fixtureStore(): VideoJobStore {
  const rows = new Map<string, VideoJob>();
  const key = (owner: string, id: string) => `${owner}:${id}`;
  return {
    claim: async job => { if (rows.has(key(job.ownerId, job.operationId))) return false; rows.set(key(job.ownerId, job.operationId), structuredClone(job)); return true; },
    get: async (owner, id) => structuredClone(rows.get(key(owner, id)) || null),
    byRequest: async (owner, id) => structuredClone([...rows.values()].find(job => job.ownerId === owner && job.requestId === id) || null),
    save: async job => { rows.set(key(job.ownerId, job.operationId), structuredClone(job)); },
    list: async owner => structuredClone([...rows.values()].filter(job => job.ownerId === owner)),
  };
}
function memory() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } }; }
async function accepted(store: VideoJobStore) {
  const result = await startVideoJob("a", { operationId, chatId: "chat-a", prompt: "Fixture video", duration: 7 }, { store, start: async input => { assert.equal(input.duration, 7); return { ok: true, requestId: "provider-job-a", model: "actual", state: "pending" }; } });
  assert.equal(result.ok, true); return result.job!;
}

test("accepted jobs survive reload and duplicate operation starts never call a provider twice", async () => {
  const store = fixtureStore(); let starts = 0;
  const start = async () => { starts++; return { ok: true as const, requestId: "provider-request", model: "fixture", state: "pending" as const }; };
  const input = { operationId, chatId: "chat-a", prompt: "Fixture", duration: 5 };
  assert.equal((await startVideoJob("a", input, { store, start })).ok, true);
  assert.equal((await startVideoJob("a", input, { store, start })).ok, true);
  assert.equal((await startVideoJob("a", { ...input, chatId: "other" }, { store, start })).ok, false);
  assert.equal(starts, 1);
  let statusCalls = 0;
  const forbidden = await pollVideoJob("b", { requestId: "provider-request" }, { store, status: async () => { statusCalls++; return { ok: true, state: "pending" }; } });
  assert.equal(forbidden.ok, false); assert.equal(statusCalls, 0);
  const recovered = await pollVideoJob("a", { operationId }, { store, status: async id => { assert.equal(id, "provider-request"); return { ok: true, state: "done", url: "https://video.example/fixture.mp4", model: "actual" }; } });
  assert.equal(recovered.ok, true); assert.equal(recovered.job?.state, "completed");
});

test("three transient status failures recover the same job without generation retries", async () => {
  const store = fixtureStore(), job = await accepted(store), storage = memory(); let checks = 0;
  const actions: string[] = [];
  const result = await pollRecoverableVideo(job, { ownerId: "a", currentOwner: () => "a", storage, fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); actions.push(body.action); checks++;
    if (checks <= 3) throw new Error("Synthetic offline");
    const status = await pollVideoJob("a", { operationId }, { store, status: async () => ({ ok: true, state: "done", url: "https://video.example/fixture.mp4" }) });
    return new Response(JSON.stringify(status));
  } }, { wait: async () => {}, maxChecks: 6 });
  assert.equal(result.ok, true); assert.deepEqual(actions, ["status", "status", "status", "status"]);
  assert.equal(readVideoRecovery(storage, "a")[0].state, "completed");
});

test("server lists retain missing local start receipts while refreshing matching owned jobs", async () => {
  const job = await accepted(fixtureStore());
  const unconfirmed = { ...job, operationId: "22222222-2222-4222-8222-222222222222", requestId: "", state: "unconfirmed" as const };
  const completed = { ...job, state: "completed" as const, url: "https://video.example/fixture.mp4" };
  const otherOwner = { ...job, ownerId: "b", operationId: "33333333-3333-4333-8333-333333333333" };
  const merged = mergeVideoRecovery([job, unconfirmed, otherOwner], [completed, otherOwner], "a");
  assert.equal(merged.length, 2);
  assert.equal(merged.find(item => item.operationId === job.operationId)?.state, "completed");
  assert.equal(merged.find(item => item.operationId === unconfirmed.operationId)?.state, "unconfirmed");
  assert.equal(merged.some(item => item.ownerId === "b"), false);
});

test("a failed server save retains the accepted provider reference without a second paid start", async () => {
  const store = fixtureStore(); let starts = 0;
  const failing = { ...store, save: async () => { throw new Error("Synthetic storage interruption"); } };
  const start = async () => { starts++; return { ok: true as const, requestId: "accepted-provider-id", model: "fixture", state: "pending" as const }; };
  const input = { operationId, chatId: "chat-a", prompt: "Fixture", duration: 5 };
  const result = await startVideoJob("a", input, { store: failing, start });
  assert.equal(result.ok, false); assert.equal(result.job?.requestId, "accepted-provider-id"); assert.equal(result.job?.state, "unconfirmed");
  const originalClaim = (await store.get("a", operationId))!;
  assert.equal(mergeVideoRecovery([result.job!], [originalClaim], "a")[0].requestId, "accepted-provider-id");
  assert.equal((await startVideoJob("a", input, { store: failing, start })).ok, false); assert.equal(starts, 1);
});

test("late account-A media cannot update account B or callbacks", async () => {
  const store = fixtureStore(), job = await accepted(store), storage = memory(); let owner = "a", updates = 0;
  const result = await pollRecoverableVideo(job, { ownerId: "a", currentOwner: () => owner, storage, fetchImpl: async () => { owner = "b"; return new Response(JSON.stringify({ ok: true, state: "done", job: { ...job, state: "completed", url: "https://video.example/fixture.mp4" }, requestId: job.requestId, model: "fixture" })); } }, { wait: async () => {}, onUpdate: () => { updates++; } });
  assert.equal(result.ok, false); assert.equal(updates, 0); assert.deepEqual(readVideoRecovery(storage, "b"), []);
});

test("invalid settings and failed local recovery storage prevent start dispatch", async () => {
  assert.equal(validateVideoSettings({ duration: 16 }).ok, false);
  assert.equal(validateVideoSettings({ duration: 1.5 }).ok, false);
  assert.equal(validateVideoSettings({ resolution: "4k" }).ok, false);
  let calls = 0;
  const result = await beginRecoverableVideo({ operationId, chatId: "c", prompt: "Fixture", settings: DEFAULT_VIDEO_SETTINGS, temporary: false }, { ownerId: "a", currentOwner: () => "a", storage: { getItem: () => null, setItem: () => { throw new Error("quota"); } }, fetchImpl: async () => { calls++; return new Response(); } });
  assert.equal(result.ok, false); assert.equal(calls, 0);
});

test("explicit owned video preservation validates content and verifies storage; temporary jobs stay temporary", async () => {
  const store = fixtureStore(), job = await accepted(store); await store.save({ ...job, state: "completed", url: "https://video.example/fixture.mp4" });
  let downloads = 0;
  const download = async () => { downloads++; return { ok: true as const, bytes: Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50]), contentType: "video/mp4" }; };
  assert.equal((await downloadOwnedVideo("b", operationId, store, download)).ok, false); assert.equal(downloads, 0);
  const copy = await downloadOwnedVideo("a", operationId, store, download); assert.equal(copy.ok, true);
  const blobs = new Map<string, Blob>();
  const blob = new Blob([new Uint8Array([0, 0, 0, 16])], { type: "video/mp4" });
  await verifyDeviceVideoCopy({ put: async (id, value) => { blobs.set(id, value); }, get: async id => blobs.get(id) }, operationId, blob);
  await assert.rejects(verifyDeviceVideoCopy({ put: async () => {}, get: async () => undefined }, operationId, blob), /could not be verified/);
  await store.save({ ...job, state: "completed", url: "https://video.example/fixture.mp4", temporary: true });
  assert.equal((await downloadOwnedVideo("a", operationId, store, download)).ok, false);
  assert.match(videoRetentionLabel(job, false), /no completed video/i);
});
