import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDashboardStatus, dashboardCollectors } from "./status.ts";
import { readLocksDirResult } from "./locks.ts";
import { toPublicDashboardStatus } from "./public-status.ts";
import { initialPollState, reducePoll } from "./status-poll.ts";
import { selectedBotFromSnapshot, telemetryDisplay } from "./telemetry-display.ts";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const OLD = "2026-11-19T12:00:00.000Z";
const commit = { sha: "a".repeat(40), subject: "Public repository change", author: "Public author", date: OLD, branch: "main" };
const offline: Partial<typeof dashboardCollectors> = {
  locks: () => ({ records: [], outcome: "empty", updatedAt: new Date(NOW).toISOString(), rejected: 0 }),
  git: () => ({ ok: false, commits: [], error: "INTERNAL_PATH" }), snapshot: () => ({ generatedAt: OLD, source: "private/build/path", commits: [commit] }),
  conductor: () => ({ source: "unavailable", nudges: [] }), dispatcher: () => ({ source: "unavailable", items: [] }),
  spend: () => ({ available: false, reason: "No source" }),
  money: () => ({ available: false, reason: "No source", source: null, currency: "USD", todayTotalUsd: null, burnPerHourUsd: null, warnings: [], asOfMs: null, eventCount: 0, stale: false, droppedInvalid: 0, todayKey: null }),
  transitions: () => "", branchCommits: () => [], sourceUpdatedAt: () => null,
  fleetPlan: () => ({ fleetStars: [], landings: [], queue: [], queueHead: null, mergeGateNote: "" }),
};

test("historical commit fallback leaves live Git unavailable and reports independent source age", async () => {
  const status = await buildDashboardStatus({}, NOW, offline);
  assert.equal(status.sources.gitOk, false);
  assert.equal(status.sources.commitsSource, "snapshot");
  assert.equal(status.commits.length, 1);
  assert.equal(status.generatedAt, new Date(NOW).toISOString());
  assert.equal(status.sources.telemetry?.commitsSnapshot.updatedAt, OLD);
  assert.equal(status.sources.telemetry?.commitsSnapshot.freshness, "historical");
  assert.equal(status.sources.telemetry?.git.outcome, "unavailable");
  assert.equal(status.sources.locksOk, true);
  assert.equal(status.sources.telemetry?.locks.outcome, "empty");
  assert.ok(status.bots.every(bot => bot.healthBasis === "development" && bot.runtimeHealth === "unverified"));
  assert.ok(status.projects.agents.every(agent => agent.basis === "development"));
});

test("a successful empty Git read stays empty instead of replacing it with a historical snapshot", async () => {
  let snapshotReads = 0;
  const status = await buildDashboardStatus({}, NOW, { ...offline, git: () => ({ ok: true, commits: [] }), snapshot: () => { snapshotReads++; return null; } });
  assert.equal(status.sources.gitOk, true);
  assert.equal(status.sources.commitsSource, "git");
  assert.equal(status.sources.telemetry?.git.outcome, "empty");
  assert.equal(snapshotReads, 0);
});

test("empty, missing, valid, partial, and invalid lock directories have distinct outcomes", () => {
  const root = mkdtempSync(join(tmpdir(), "mind-dashboard-locks-"));
  try {
    assert.equal(readLocksDirResult(join(root, "missing")).outcome, "unavailable");
    assert.equal(readLocksDirResult(root).outcome, "empty");
    writeFileSync(join(root, "good.lock"), "owner: Logic Bot\nstatus: claimed\n");
    assert.equal(readLocksDirResult(root).outcome, "available");
    mkdirSync(join(root, "bad.lock"));
    assert.equal(readLocksDirResult(root).outcome, "partial");
    rmSync(join(root, "good.lock"));
    assert.equal(readLocksDirResult(root).outcome, "invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("collector and rendering failures retain independent sources and explicit unavailable receipts", async () => {
  const throws = () => { throw new Error("PRIVATE_FAILURE_DETAILS"); };
  const status = await buildDashboardStatus({}, NOW, { ...offline, conductor: throws, charts: throws, mirror: throws, projects: throws });
  assert.equal(status.commits.length, 1);
  for (const id of ["conductor", "charts", "notionMirror", "projects"]) assert.equal(status.sources.telemetry?.[id].outcome, "failed");
  assert.match(status.charts.commitsPerDay.emptyReason!, /generation failed/);
  assert.equal(status.notionMirror.available, false);
  assert.equal(status.projects.available, false);
  assert.ok(!JSON.stringify(status).includes("PRIVATE_FAILURE_DETAILS"));
});

test("all independent collectors can fail without calling the failing chart builder a second time", async () => {
  let chartCalls = 0;
  const fail = () => { throw new Error("fixture failure"); };
  const status = await buildDashboardStatus({}, NOW, { ...offline, locks: fail, git: fail, snapshot: fail, conductor: fail, dispatcher: fail, spend: fail, money: fail, transitions: fail, branchCommits: fail, timeline: fail, constellations: fail, edges: fail, weather: fail, fleetPlan: fail, skyFeed: fail, charts: () => { chartCalls++; return fail(); }, mirror: fail, projects: fail });
  assert.equal(chartCalls, 1);
  assert.equal(status.sources.gitOk, false);
  assert.equal(status.sources.locksOk, false);
  assert.equal(status.commits.length, 0);
  assert.equal(status.sources.telemetry?.charts.outcome, "failed");
});

test("public publication explicitly excludes new top-level and nested fields plus private notes and sources", async () => {
  const status = await buildDashboardStatus({}, NOW, offline);
  const marker = "PRIVATE_FIXTURE_SECRET";
  Object.assign(status, { diagnostics: marker, account: marker });
  Object.assign(status.bots[0], { token: marker, notes: marker });
  status.bots[0].lock = { file: marker, owner: marker, branch: "main", status: `claimed ${marker}`, claimed_at: null, released_at: null, commits: [], notes: marker, worktree: marker, raw: { secret: marker } };
  status.conductor = { source: marker, nudges: [marker] };
  status.spend = { available: true, entries: [{ path: marker, key: marker }] };
  Object.assign(status.charts.botHealth.points, { privateDiagnostic: marker });
  status.charts.botHealth.points.push(Object.assign({ label: "Public", value: 1 }, { privateDiagnostic: marker }));
  Object.assign(status.sources.telemetry!.git, { privateDiagnostic: marker });
  status.sources.telemetry!.account = { ...status.sources.telemetry!.git, updatedAt: marker };
  const result = toPublicDashboardStatus(status);
  const json = JSON.stringify(result);
  assert.ok(!json.includes(marker));
  assert.equal(result.bots[0].lock?.status, "claimed");
  assert.ok(!("locksDir" in result.sources));
  assert.ok(!("account" in result.sources.telemetry));
  assert.equal(result.commits[0].sha, commit.sha);
  assert.equal(result.sources.telemetry.git.outcome, "unavailable");
});

test("refresh display remains amber while stale and resolves selected details from each new snapshot", async () => {
  const status = await buildDashboardStatus({}, NOW, offline);
  let poll = reducePoll(initialPollState<typeof status>(), { type: "success", seq: 1, data: status });
  assert.equal(telemetryDisplay(poll, false).tone, "current");
  assert.match(telemetryDisplay(poll, true).label, /Refreshing/);
  const id = status.bots[0].id;
  const nextBot = { ...status.bots[0], branch: "new-branch", health: "blocked" as const };
  assert.equal(selectedBotFromSnapshot([nextBot], id)?.branch, "new-branch");
  assert.equal(selectedBotFromSnapshot([], id), null);
  poll = reducePoll(poll, { type: "failure", seq: 2, error: "offline", at: new Date(NOW).toISOString() });
  assert.equal(telemetryDisplay(poll, false).tone, "stale");
  assert.equal(telemetryDisplay(poll, true).tone, "stale");
  poll = reducePoll(poll, { type: "success", seq: 3, data: status });
  assert.equal(telemetryDisplay(poll, false).tone, "current");
});
