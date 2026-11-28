import assert from "node:assert/strict";
import test from "node:test";
import { appendBuildResultToChat, buildResultKey, MAX_BUILD_RESULT_CHARACTERS, parseBuildResult, serializeBuildResult, type BuildReturnSource, type BuildStoredResult } from "./build-result.ts";
import { emptyWorkspace } from "../workspace.ts";
import { buildRunPath, workLocation } from "../app-location.ts";

const result: BuildStoredResult = { owner: "A", job: { id: "local", status: "error", output: "recorded", error: "Process closed", createdAt: "2026-01-01", updatedAt: "2026-01-01" }, receipt: { operationId: "fixture", requestDispatched: true, outputComplete: true, verification: { implementation: "unverified", checks: [{ id: "acceptance", status: "not_run" }] } } };

test("receipts above the old two-million-character cutoff are recovered completely with failure state", () => {
  const full: BuildStoredResult = { ...result, job: { ...result.job, output: "x".repeat(1_000_000) + "TRAILING FAILURE" }, receipt: { ...result.receipt, filesChanged: [{ path: "first", before: "a".repeat(600_000), after: "b".repeat(600_000) }] } };
  const raw = serializeBuildResult(full); assert.ok(raw.length > 2_000_000);
  const restored = parseBuildResult(raw, "A"); assert.equal(restored?.job.status, "error"); assert.ok(restored?.job.output.endsWith("TRAILING FAILURE"));
  assert.equal(restored?.receipt?.filesChanged?.[0]?.after.length, 600_000);
  assert.equal(parseBuildResult(raw, "B"), null); assert.notEqual(buildResultKey("A"), buildResultKey("B"));
});

test("unsupported or malformed receipts fail explicitly and retain the existing persisted record", () => {
  let existing = serializeBuildResult(result);
  assert.throws(() => { existing = serializeBuildResult({ ...result, job: { ...result.job, output: "x".repeat(MAX_BUILD_RESULT_CHARACTERS) } }); }, /Download/);
  assert.equal(parseBuildResult(existing, "A")?.receipt?.operationId, "fixture");
  assert.throws(() => parseBuildResult("x".repeat(MAX_BUILD_RESULT_CHARACTERS + 1), "A"), /retained/);
  assert.throws(() => parseBuildResult(JSON.stringify({ ...result, receipt: { verification: { checks: "pretend-pass" } } }), "A"), /No check was assumed/);
});

test("completed paired result returns to its original project conversation once", () => {
  const source: BuildReturnSource = { chatId: "chat-a", runId: "abcde123".repeat(4), runtime: "paired" };
  const saved: BuildStoredResult = { ...result, projectId: "project-a", source, job: { ...result.job, id: source.runId, status: "done", error: "" } };
  const raw = serializeBuildResult(saved);
  assert.deepEqual(parseBuildResult(raw, "A", "project-a")?.source, source);
  assert.equal(parseBuildResult(raw, "A", "project-b"), null);
  const chat = { id: "chat-a", title: "Fixture", projectId: "project-a", temporary: false, memory: "off" as const, autonomy: "ask" as const, retrievalLog: [], messages: [] };
  const workspace = { ...emptyWorkspace(), chats: [chat] };
  const href = buildRunPath("project-a", source.runId);
  assert.deepEqual(workLocation(href.slice(1)), { projectId: "project-a", runId: source.runId });
  const returned = appendBuildResultToChat(workspace, "project-a", source, saved.job, href);
  assert.ok(returned);
  assert.match(returned.chats[0]?.messages[0]?.content ?? "", /Open Build run/);
  assert.equal(appendBuildResultToChat(returned, "project-a", source, saved.job, href), returned);
  assert.equal(appendBuildResultToChat(workspace, "project-b", source, saved.job, href), null);
  assert.equal(appendBuildResultToChat(workspace, "project-a", source, { ...saved.job, status: "cancelled" }, href), null);
  assert.equal(appendBuildResultToChat(workspace, "project-a", source, { ...saved.job, id: "0011".repeat(8) }, href), null);
  assert.equal(appendBuildResultToChat({ ...workspace, chats: [{ ...chat, archived: true }] }, "project-a", source, saved.job, href), null);
});
