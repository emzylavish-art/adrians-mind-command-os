import assert from "node:assert/strict";
import { test } from "node:test";
import { generateImagineImages, editImagineImage } from "./imagine.ts";
import { startOwnerVideo, VIDEO_MODEL } from "./video.ts";
import { startVideoJob, pollVideoJob, type VideoJob, type VideoJobStore } from "./video-jobs.ts";
import { resetImagineRateLimitForTests } from "./harden.ts";
import { resetImagineSpendLedgerForTests } from "./spend-ledger.ts";
import type { MonetarySettlement } from "../financial-policy.ts";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const image = "data:image/png;base64," + png;

test("the shared Imagine generation/edit adapters enforce exactly one contextual account gate", async () => {
  for (const edit of [false, true]) {
    resetImagineRateLimitForTests(); resetImagineSpendLedgerForTests();
    let reserves = 0, sends = 0; const settlements: MonetarySettlement[] = [];
    const options = { apiKey: "synthetic-key", meter: { ownerId: "owner", operationId: "operation", taskId: "task" },
      reserveDispatch: async (owner: string, context: import("../financial-policy.ts").MonetaryDispatchContext) => {
        reserves++; assert.equal(owner, "owner"); assert.equal(context.provider, "xai"); assert.equal(context.model, "grok-imagine-image"); assert.equal(context.taskId, "task"); assert.equal(context.textOnly, false); assert.match(context.operationId, edit ? /image-edit$/ : /image-generate$/); assert.equal(JSON.stringify(context).includes("synthetic-key"), false);
        return { ok: true as const, reservationId: "reservation" };
      },
      settleDispatch: async (_owner: string, id: string | undefined, receipt: MonetarySettlement) => { assert.equal(id, "reservation"); settlements.push(receipt); },
      fetchImpl: async () => { sends++; return Response.json({ data: [{ b64_json: png }] }, { headers: { "x-request-id": "image-request" } }); },
    };
    const result = edit ? await editImagineImage({ prompt: "Fixture edit", imageDataUrl: image }, options) : await generateImagineImages({ prompt: "Fixture generate" }, options);
    assert.equal(result.ok, true); assert.equal(reserves, 1); assert.equal(sends, 1);
    assert.deepEqual(settlements, [{ outcome: "completed", providerRequestId: "image-request" }]);
  }
});

test("image budget rejection and invalid selections send nothing; a post-dispatch failure keeps unknown money", async () => {
  resetImagineRateLimitForTests(); resetImagineSpendLedgerForTests(); let reserves = 0, sends = 0; const settlements: MonetarySettlement[] = [];
  const options = { apiKey: "synthetic-key", meter: { ownerId: "owner" }, reserveDispatch: async () => { reserves++; return { ok: false as const, error: "Fixture cap", status: 429 }; }, fetchImpl: async () => { sends++; return Response.json({}); } };
  assert.equal((await generateImagineImages({ prompt: "Fixture" }, options)).ok, false);
  assert.equal(reserves, 1); assert.equal(sends, 0);
  assert.equal((await editImagineImage({ prompt: "Fixture", imageDataUrls: [image, "https://external.invalid/image.png"] }, options)).ok, false);
  assert.equal(reserves, 1); assert.equal(sends, 0);
  assert.equal((await generateImagineImages({ prompt: "" }, options)).ok, false);
  assert.equal((await generateImagineImages({ prompt: "Fixture" }, { ...options, apiKey: "" })).ok, false);
  assert.equal(reserves, 1);
  const failed = await generateImagineImages({ prompt: "Fixture" }, { ...options, reserveDispatch: async () => ({ ok: true, reservationId: "reservation" }), settleDispatch: async (_owner, _id, receipt) => { settlements.push(receipt); }, fetchImpl: async () => { throw new Error("Synthetic interruption"); } });
  assert.equal(failed.ok, false); assert.deepEqual(settlements, [{ outcome: "unknown" }]);
});

test("durable video claims gate one paid start; restart/status reads do not reserve or resubmit", async () => {
  const rows = new Map<string, VideoJob>();
  const store: VideoJobStore = { claim: async job => { if (rows.has(job.operationId)) return false; rows.set(job.operationId, job); return true; }, get: async (owner, id) => rows.get(id)?.ownerId === owner ? rows.get(id)! : null, byRequest: async (owner, request) => [...rows.values()].find(row => row.ownerId === owner && row.requestId === request) || null, save: async job => { rows.set(job.operationId, job); }, list: async owner => [...rows.values()].filter(row => row.ownerId === owner) };
  const operationId = "11111111-1111-4111-8111-111111111111"; let reserves = 0, sends = 0; const settlements: MonetarySettlement[] = [];
  const input = { operationId, prompt: "Fixture video", duration: 5 };
  const start = (settings: Parameters<typeof startOwnerVideo>[0]) => startOwnerVideo(settings, { ownerId: "owner", apiKey: "synthetic", operationId,
    reserve: async (_owner, context) => { reserves++; assert.equal(context.model, VIDEO_MODEL); assert.equal(context.textOnly, false); return { ok: true, reservationId: "reservation" }; },
    settle: async (_owner, _id, receipt) => { settlements.push(receipt); },
    fetchImpl: async () => { sends++; return Response.json({ request_id: "fixture-provider-request" }); },
  });
  assert.equal((await startVideoJob("owner", input, { store, start })).ok, true);
  assert.equal((await startVideoJob("owner", input, { store, start })).ok, true);
  assert.equal((await pollVideoJob("owner", { operationId }, { store, status: async () => ({ ok: true, state: "pending" }) })).ok, true);
  assert.equal(reserves, 1); assert.equal(sends, 1);
  assert.deepEqual(settlements, [{ outcome: "completed", providerRequestId: "fixture-provider-request" }]);
});

test("known unsent video failures are final failed states and consume no generation allowance", async () => {
  let reserves = 0, sends = 0;
  const options = { ownerId: "owner", apiKey: "", reserve: async () => { reserves++; return { ok: true as const }; }, fetchImpl: async () => { sends++; return Response.json({}); } };
  const missing = await startOwnerVideo({ prompt: "Fixture" }, options);
  assert.equal(missing.ok, false); if (!missing.ok) assert.equal(missing.dispatched, false);
  assert.equal(reserves, 0); assert.equal(sends, 0);
  const denied = await startOwnerVideo({ prompt: "Fixture" }, { ...options, apiKey: "synthetic", reserve: async () => ({ ok: false, status: 503, error: "Fixture ledger unavailable" }) });
  assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.dispatched, false);
  assert.equal(sends, 0);
});
