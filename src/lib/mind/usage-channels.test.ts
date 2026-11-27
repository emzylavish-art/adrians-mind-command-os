import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { editImagineImage, generateImagineImages } from "./media/imagine.ts";
import { buildRuntimeUsage, observeBuildRuntime, type UsageRecorder } from "./usage-observation.server.ts";
import type { UsageReceipt } from "./usage-ledger.ts";
import { normalizeWorkspace } from "./workspace.ts";
import { readBuildSourceReceipt } from "./kimi/source-receipt.ts";
import { buildBranchName } from "./kimi/build-scope.ts";

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const imageResponse = () => Response.json({ data: [{ b64_json: pixel }], model: "reported-image-model", usage: { prompt_tokens: 0 } }, { headers: { "x-request-id": "image-fixture-1" } });

test("C5 AA041 image generation and edits record each real POST without copying content or inventing usage", async () => {
  const rows: { ownerId: string; receipt: UsageReceipt }[] = [];
  const recordUsage: UsageRecorder = async (ownerId, receipt) => { rows.push({ ownerId, receipt }); };
  let calls = 0;
  const options = { skipSpendControls: true, apiKey: "fixture-private-key", meter: { ownerId: "owner-a", chatId: "chat-a" }, recordUsage,
    fetchImpl: async () => { calls++; assert.equal(rows.at(-1)?.receipt.dispatched, true); return imageResponse(); } };
  const generated = await generateImagineImages({ prompt: "private fixture prompt" }, options);
  const edited = await editImagineImage({ prompt: "private fixture edit", imageDataUrl: `data:image/png;base64,${pixel}` }, options);
  assert.equal(generated.ok, true); assert.equal(edited.ok, true); assert.equal(calls, 2);
  assert.equal(rows.length, 6);
  for (const start of [0, 3]) {
    assert.equal(new Set(rows.slice(start, start + 3).map(row => row.receipt.id)).size, 1);
    assert.equal(rows[start].receipt.dispatched, false);
    const final = rows[start + 2];
    assert.equal(final.ownerId, "owner-a"); assert.equal(final.receipt.chatId, "chat-a");
    assert.equal(final.receipt.channel, "image"); assert.equal(final.receipt.outcome, "completed");
    assert.equal(final.receipt.provider, "xai"); assert.equal(final.receipt.providerDispatch, "sent");
    assert.equal(final.receipt.model, "reported-image-model"); assert.equal(final.receipt.requestId, "image-fixture-1");
    assert.equal(final.receipt.promptTokens, 0); assert.equal(final.receipt.completionTokens, null);
  }
  assert.notEqual(rows[0].receipt.operationId, rows[3].receipt.operationId);
  assert.deepEqual([rows[2].receipt.stage, rows[5].receipt.stage], ["generation", "edit"]);
  for (const secret of ["private fixture", "fixture-private-key", pixel, "estimatedCostUsd"]) assert.equal(JSON.stringify(rows).includes(secret), false);
});

test("C5 AA041 image preflight storage failure prevents dispatch; post-dispatch uncertainty never retries", async () => {
  let calls = 0;
  const rows: UsageReceipt[] = [];
  const base = { skipSpendControls: true, apiKey: "fixture-key", meter: { ownerId: "owner-a" } };
  const unavailable = await generateImagineImages({ prompt: "fixture" }, { ...base, recordUsage: async () => { throw Error("storage fixture"); }, fetchImpl: async () => { calls++; return imageResponse(); } });
  assert.equal(unavailable.ok, false); assert.equal(calls, 0);
  const missingKey = await generateImagineImages({ prompt: "fixture" }, { ...base, apiKey: "", recordUsage: async (_owner, row) => { rows.push(row); }, fetchImpl: async () => { calls++; return imageResponse(); } });
  assert.equal(missingKey.ok, false); assert.equal(rows.length, 0); assert.equal(calls, 0);
  for (const kind of ["lost", "rate-limit", "malformed"] as const) {
    const result = await generateImagineImages({ prompt: "fixture" }, { ...base, recordUsage: async (_owner, row) => { rows.push(row); }, fetchImpl: async () => {
      calls++;
      if (kind === "lost") throw Error("lost fixture response");
      return kind === "rate-limit" ? Response.json({ error: "fixture" }, { status: 429 }) : new Response("not JSON");
    } });
    assert.equal(result.ok, false);
    assert.equal(rows.at(-1)?.outcome, kind === "rate-limit" ? "failed" : "unconfirmed");
    assert.equal(rows.at(-1)?.model, "unknown"); assert.equal(rows.at(-1)?.promptTokens, null);
  }
  assert.equal(calls, 3); assert.equal(new Set(rows.map(row => row.operationId)).size, 3);
  let saves = 0;
  const delivered = await generateImagineImages({ prompt: "fixture" }, { ...base, recordUsage: async () => { if (++saves > 1) throw Error("late storage loss"); }, fetchImpl: async () => { calls++; return imageResponse(); } });
  assert.equal(delivered.ok, true); assert.equal(calls, 4);
});

function buildHandlerFixture() {
  let owner = "owner-a";
  let paired = true;
  let runtimeCalls = 0;
  const job = { id: "fixture-job", ownerId: "owner-a", kind: "kimi-acp", status: "queued", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", payload: {} };
  const imports: Record<string, unknown> = {
    "./runtime-capabilities.ts": { buildRuntimeCapabilities: () => [{}, { coding: true }] },
    "./hosted/file-receipts.ts": { readCodingFileSnapshot: () => ({ ok: true, exists: true, content: "fixture source" }) },
    "./build-guidance.ts": { prepareBuildTask: (prompt: string) => ({ ok: true, prompt, skillReceipts: [] }) },
    "./build-scope.ts": { buildBranchName },
    "./paired-build-receipt.ts": { pairedBuildPayload: () => ({}), pairedBuildReceipt: () => null },
    "../media/xai-key.ts": { resolveXaiInferenceApiKey: () => "fixture" },
    "../dispatch-attempt.ts": { dispatchContext: () => ({ operationId: "build:fixture-" + runtimeCalls }), reserveDispatchAttempt: async () => ({ok:true}), runSettledDispatch: async (_owner: string, _id: string, work: () => Promise<unknown>) => work() },
    "./account-workspace.ts": { machineRequired: "fixture machine required" },
    "../../auth/verify.server": { requireUserId: async () => owner },
    "../connectors/oauth-csrf": { assertSameOrigin: () => ({ ok: true }) },
    "../halt.server": { haltIsOn: async () => false },
    "../pc-pairing/coordination.server.ts": { enqueueJob: () => job, listJobEvents: () => [], onlineAgents: () => paired ? [{ id: "pc-a", label: "Fixture" }] : [], readJob: () => job },
    "node:fs": { readFileSync: () => "fixture source" }, "node:path": { join },
    "./hosted/acp-client.ts": { adrianBuildCommand: () => "fixture.mjs", adrianHostedWorkspace: () => "/fixture", closeHostedCodingSession: () => true, packageLabel: () => "fixture", resolveBuildWorkspace: () => "/fixture",
      runCodingTurn: async () => { runtimeCalls++; return { ok: true, output: "private output", command: "fixture" }; },
      runHostedPrompt: async () => { runtimeCalls++; return { status: "session_created", output: "partial private output", command: "fixture" }; } },
    "./hosted/shell.server.ts": { snapshotHostedWorkspace: () => ({}), readHostedGitBranch: async () => "feature/fixture" }, "./persist.ts": { recordKimiAttempt: async () => {} },
    "./source-receipt.ts": { readBuildSourceReceipt }, "node:crypto": { createHash, randomUUID: () => `local-${runtimeCalls}` },
    "../usage-observation.server.ts": { buildRuntimeUsage, observeBuildRuntime, recordUsageObservation: async () => { throw Error("must inject recorder"); } },
  };
  const module = { exports: {} as { handleKimiSession: (request: Request, deps: { recordUsage: UsageRecorder }) => Promise<Response> } };
  const code = ts.transpileModule(readFileSync(new URL("./kimi/acp.server.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { module, exports: module.exports, require: (name: string) => { assert.ok(name in imports, name); return imports[name]; }, Response, URL });
  return { run: module.exports.handleKimiSession, job, owner: (value: string) => { owner = value; }, local: () => { paired = false; owner = "dev-user"; }, runtimeCalls: () => runtimeCalls };
}

test("Build route verifies the checkout before dispatch and refuses named branches on unsupported runtimes", async () => {
  const fixture = buildHandlerFixture();
  const deps = { recordUsage: async () => {} };
  const run = (expectedBranch: string) => fixture.run(new Request("https://fixture.test/api/mind/build/session", { method: "POST", body: JSON.stringify({ prompt: "fixture", mode: "plan", expectedBranch }) }), deps);
  assert.equal((await run("feature/fixture")).status, 409);
  fixture.local();
  assert.equal((await run("--invalid")).status, 400);
  assert.equal((await run("main")).status, 409);
  assert.equal(fixture.runtimeCalls(), 0);
  const matched = await run("feature/fixture");
  assert.equal(matched.status, 200);
  assert.equal((await matched.json()).verifiedBranch, "feature/fixture");
  assert.equal(fixture.runtimeCalls(), 1);
});

test("C5 AA041 actual Build handler retains queued and observed job lifecycle under one owner-bound identity", async () => {
  const fixture = buildHandlerFixture();
  const rows: { owner: string; receipt: UsageReceipt }[] = [];
  const deps = { recordUsage: async (owner: string, receipt: UsageReceipt) => { rows.push({ owner, receipt }); } };
  assert.equal((await fixture.run(new Request("https://fixture.test/api/mind/build/session", { method: "POST", body: JSON.stringify({ prompt: "private prompt" }) }), deps)).status, 202);
  assert.equal(rows[0].receipt.executionState, "queued"); assert.equal(rows[0].receipt.dispatched, false);
  assert.equal(rows[0].receipt.providerDispatch, "not_sent"); assert.equal(fixture.runtimeCalls(), 0);
  fixture.job.status = "done";
  assert.equal((await fixture.run(new Request("https://fixture.test/api/mind/build/session?jobId=fixture-job"), deps)).status, 200);
  assert.equal(rows[1].receipt.id, rows[0].receipt.id); assert.equal(rows[1].receipt.at, rows[0].receipt.at);
  assert.equal(rows[1].receipt.executionState, "completed"); assert.equal(rows[1].receipt.providerDispatch, "unknown");
  assert.equal(rows[1].receipt.outcome, "unconfirmed"); assert.equal(rows[1].receipt.provider, "unknown");
  assert.equal(rows[1].receipt.promptTokens, null); assert.equal(rows[1].receipt.completionTokens, null);
  fixture.owner("stranger");
  assert.equal((await fixture.run(new Request("https://fixture.test/api/mind/build/session?jobId=fixture-job"), deps)).status, 404);
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.owner === "owner-a"));
  assert.equal(JSON.stringify(rows).includes("private prompt"), false);
});

test("C5 AA041 hosted Build does not confuse a completed runtime or a legacy partial reply with provider proof", async () => {
  const fixture = buildHandlerFixture(); fixture.local();
  const rows: UsageReceipt[] = [];
  const deps = { recordUsage: async (_owner: string, receipt: UsageReceipt) => { rows.push(receipt); } };
  for (const body of [{ prompt: "private prompt", mode: "plan" }, { prompt: "private prompt" }]) {
    assert.equal((await fixture.run(new Request("https://fixture.test/api/mind/build/session", { method: "POST", body: JSON.stringify(body) }), deps)).status, 200);
  }
  assert.equal(fixture.runtimeCalls(), 2); assert.equal(rows.length, 4);
  assert.equal(rows[1].executionState, "completed"); assert.equal(rows[3].executionState, undefined);
  assert.ok(rows.every(row => row.channel === "build" && row.outcome === "unconfirmed" && row.providerDispatch === "unknown"));
  assert.ok(rows.every(row => row.model === "unknown" && row.promptTokens === null && row.completionTokens === null));
  assert.equal(JSON.stringify(rows).includes("private"), false);
  const normalized = normalizeWorkspace({ usage: rows });
  assert.equal(normalized.usage[1].executionState, "completed"); assert.equal(normalized.usage[1].providerDispatch, "unknown");
  assert.equal(normalizeWorkspace({ usage: [{ ...rows[0], executionState: "pretend", providerDispatch: "pretend" }] }).usage[0].executionState, undefined);
});
