import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canRetryAgentRequest, snapshotAgentRequest, summarizeAgentModelRounds } from "./agent-request.ts";

test("agent approval retry retains exact owner, task, project and bytes after selection changes", () => {
  const input = { goal: "Check the original synthetic project", modelTier: "Fast" as const, projectId: "original-project", freeOnly: false, projects: ["Original"], chats: ["Original chat"], notes: ["Original note"], images: [{ dataUrl: "data:image/png;base64,original", origin: "uploaded" }] };
  const snapshot = snapshotAgentRequest("owner-A", "agent:fixture", input);
  input.projectId = "new-project"; input.notes[0] = "new note"; input.images[0].dataUrl = "different";
  const body = JSON.parse(snapshot.body);
  assert.equal(body.operationId, "agent:fixture"); assert.equal(body.taskId, "agent:fixture");
  assert.equal(body.projectId, "original-project"); assert.equal(body.images[0].dataUrl, "data:image/png;base64,original");
  assert.deepEqual(body.notes, ["Original note"]);
  const denied = { ok: false, operationId: "agent:fixture", dispatched: false };
  assert.equal(canRetryAgentRequest(snapshot, "owner-A", denied), true);
  assert.equal(canRetryAgentRequest(snapshot, "owner-B", denied), false);
  assert.equal(canRetryAgentRequest(snapshot, "owner-A", { ...denied, operationId: "different" }), false);
  assert.equal(canRetryAgentRequest(snapshot, "owner-A", { ...denied, retryable: false }), false);
  for (const dispatched of [undefined, true, "false"]) assert.equal(canRetryAgentRequest(snapshot, "owner-A", { ...denied, dispatched }), false);
});

test("agent snapshots refuse oversized requests without truncating or inventing a replacement identity", () => {
  const body = { goal: "Synthetic", modelTier: "Auto" as const, projectId: null, freeOnly: false, projects: [], chats: [], notes: [], images: [{ dataUrl: "x".repeat(2_500_000) }] };
  assert.throws(() => snapshotAgentRequest("owner", "agent:fixture", body), /too large/);
  assert.throws(() => snapshotAgentRequest("", "agent:fixture", { ...body, images: [] }), /verified owner/);
});

test("mounted planner sends its immutable snapshot and retries only the proven unsent operation", () => {
  const source = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
  const section = source.slice(source.indexOf("async function runPlanner("), source.indexOf("async function runPlanner(") + 6500);
  assert.match(section, /body: requestSnapshot\.body/);
  assert.match(section, /canRetryAgentRequest\(requestSnapshot, draftOwner, payload\)/);
  assert.match(section, /runPlanner\(requestSnapshot\)/);
  assert.match(section, /turnOwner\.current !== requestSnapshot\.ownerId/);
});

test("planner receipts distinguish requested and returned models and never fill missing proof with configuration", () => {
  const rows = summarizeAgentModelRounds([
    { step: 1, provider: "xai", requestedModel: "requested-fixture", reportedModel: "returned-fixture", requestId: "request-fixture", state: "responded" },
    { step: 2, provider: "xai", requestedModel: "requested-fixture", state: "not_sent" },
    { step: 3, state: "made_up_success" },
  ]);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /requested requested-fixture · reported returned-fixture/);
  assert.match(rows[1], /reported not supplied · not sent/);
  assert.ok(rows.every(row => /No billed amount was supplied; task output remains unverified/.test(row)));
});
