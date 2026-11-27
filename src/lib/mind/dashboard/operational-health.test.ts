import assert from "node:assert/strict";
import { test } from "node:test";
import { readFleet, type AgentRun } from "../fleet.ts";
import { buildOperationalHealth } from "./operational-health.ts";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const iso = (offset: number) => new Date(NOW + offset).toISOString();
const worker = { state: "offline" as const, detail: "No local worker heartbeat is available. Hosted execution is unverified." };
function run(id: string, state: AgentRun["state"], operationState?: NonNullable<AgentRun["externalOperation"]>["state"], duration = 100): AgentRun {
  return readFleet({ runs: [{ id, agentId: "agent", state, createdAt: iso(-60_000), updatedAt: iso(-1000), externalOperation: operationState ? { id: `op-${id}`, stepId: "step", state: operationState, startedAt: iso(-1000 - duration), finishedAt: operationState === "dispatching" ? undefined : iso(-1000) } : undefined }] }).runs[0];
}

test("operational receipts report known successes, failures, unknowns, and measured latency separately", () => {
  const runs = [run("success", "completed", "succeeded", 100), run("failed", "failed", "failed", 400), run("unknown", "failed", "unknown", 800), run("pending", "running", "dispatching"), run("queued", "queued")];
  runs[0].verification = { state: "unverified", detail: "No objective check" };
  const health = buildOperationalHealth({ now: NOW, runs, storageReadable: true, snapshotUpdatedAt: iso(-10_000), worker, revision: "a".repeat(40) });
  assert.deepEqual([health.metrics.acknowledged, health.metrics.failed, health.metrics.unknown, health.metrics.pending], [1, 1, 1, 1]);
  assert.equal(health.metrics.requestSuccessRate, .5);
  assert.equal(health.metrics.latencySampleCount, 2);
  assert.equal(health.metrics.medianLatencyMs, 100);
  assert.equal(health.metrics.p95LatencyMs, 400);
  assert.equal(health.metrics.oldestQueueAgeMs, 60_000);
  assert.equal(health.metrics.verifiedObjectives, 0);
  assert.equal(health.revision, "a".repeat(40));
  assert.equal(health.components.find(row => row.id === "voice")?.state, "unverified");
  assert.equal(health.components.find(row => row.id === "notion")?.state, "unverified");
});

test("no receipts yields unmeasured rates and no invented provider/device availability", () => {
  const health = buildOperationalHealth({ now: NOW, runs: [], storageReadable: true, worker, revision: "main" });
  assert.equal(health.metrics.requestSuccessRate, null);
  assert.equal(health.metrics.medianLatencyMs, null);
  assert.equal(health.metrics.p95LatencyMs, null);
  assert.equal(health.metrics.completionRate, null);
  assert.equal(health.revision, null);
  assert.equal(health.components.find(row => row.id === "connected_execution")?.state, "unverified");
  assert.equal(health.components.find(row => row.id === "storage")?.state, "observed");
  assert.match(health.components.find(row => row.id === "storage")!.detail, /No write test/);
});

test("an old successful receipt cannot report current runtime availability", () => {
  const recorded = run("old", "completed", "succeeded");
  recorded.externalOperation!.startedAt = iso(-60 * 60_000);
  recorded.externalOperation!.finishedAt = iso(-59 * 60_000);
  const health = buildOperationalHealth({ now: NOW, runs: [recorded], storageReadable: true, worker });
  assert.equal(health.components.find(row => row.id === "connected_execution")?.state, "unverified");
  assert.equal(health.metrics.acknowledged, 1);
  assert.match(health.population, /not all application requests/);
});

test("a recent failure supersedes earlier success and an unreadable workspace stays unavailable", () => {
  const success = run("success", "completed", "succeeded");
  success.externalOperation!.finishedAt = iso(-5000);
  const failed = run("failed", "failed", "failed");
  const health = buildOperationalHealth({ now: NOW, runs: [success, failed], storageReadable: true, worker });
  assert.equal(health.components.find(row => row.id === "connected_execution")?.state, "needs_attention");
  const unavailable = buildOperationalHealth({ now: NOW, runs: [], storageReadable: false, worker });
  assert.equal(unavailable.components.find(row => row.id === "storage")?.state, "unavailable");
  assert.equal(unavailable.components.find(row => row.id === "connected_execution")?.state, "unavailable");
});

test("invalid/future operation timing is excluded from measured latency", () => {
  const recorded = run("clock", "completed", "succeeded");
  recorded.externalOperation!.finishedAt = iso(5000);
  const health = buildOperationalHealth({ now: NOW, runs: [recorded], storageReadable: true, worker });
  assert.equal(health.metrics.invalidTiming, 1);
  assert.equal(health.components.find(row => row.id === "connected_execution")?.state, "unverified");
  assert.equal(health.metrics.latencySampleCount, 0);
  assert.equal(health.metrics.medianLatencyMs, null);
});


test("worker freshness uses the actual heartbeat time rather than the health response time", () => {
  const health = buildOperationalHealth({ now: NOW, runs: [], storageReadable: true, worker: { state: "local", detail: "Local heartbeat only.", heartbeatAt: iso(-30_000) } });
  assert.equal(health.components.find(row => row.id === "worker")?.lastVerifiedAt, iso(-30_000));
});

test("a policy refusal is visibly not sent and is excluded from provider success-rate and latency samples",()=>{
  const health=buildOperationalHealth({now:NOW,runs:[run("refused","paused","not_sent")],storageReadable:true,worker});
  assert.equal(health.history[0]!.state,"not_sent");assert.equal(health.metrics.failed,0);assert.equal(health.metrics.unknown,0);assert.equal(health.metrics.latencySampleCount,0);assert.equal(health.metrics.requestSuccessRate,null);
  assert.match(health.components.find(row=>row.id==="connected_execution")!.detail,/refused before provider dispatch/);
});
