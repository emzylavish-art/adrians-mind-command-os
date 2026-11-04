import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sql } from "../db.ts";
import type { ScheduleJob } from "./fleet.ts";
import type { Workspace } from "./types.ts";
import { claimSchedules, runWorkerPass } from "./worker-pass.ts";
import { emptyWorkspace } from "./workspace.ts";

function job(partial: Partial<ScheduleJob> & Pick<ScheduleJob, "id" | "name" | "nextRunAt">): ScheduleJob {
  return {
    agentId: null,
    intervalMinutes: 60,
    lastRunAt: null,
    enabled: true,
    lastError: "",
    timeZone: "UTC",
    clockHour: null,
    clockMinute: null,
    leaseWorker: null,
    leaseUntil: null,
    lastStatus: "",
    ...partial,
  };
}

function db(initial: { userId: string; ws: Workspace }[]) {
  const snaps = new Map(initial.map((item) => [item.userId, JSON.stringify(item.ws)]));
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    if (text.includes("select user_id")) return [...snaps.entries()].map(([user_id, payload]) => ({ user_id, payload }));
    if (text.includes("insert into mind_snapshot")) snaps.set(String(values[0]), String(values[1]));
    return [];
  }) as Sql;
  sql.query = async () => [];
  return { sql, snaps };
}

describe("worker pass", () => {
  it("persists one due job and does not run another owner or the same job twice", async () => {
    const due = emptyWorkspace();
    due.schedules.push(job({ id: "job-1", name: "Morning", nextRunAt: "2026-04-01T12:00:00.000Z" }));
    const later = emptyWorkspace();
    later.schedules.push(job({ id: "job-2", name: "Later", nextRunAt: "2026-04-02T12:00:00.000Z" }));
    const { sql, snaps } = db([{ userId: "owner-a", ws: due }, { userId: "owner-b", ws: later }]);
    const first = await runWorkerPass(sql, "2026-04-01T12:00:00.000Z", "worker-a", () => ({ ok: true, detail: "Test executor completed the job." }));
    assert.equal(first.ran, 1);
    const savedA = JSON.parse(snaps.get("owner-a") ?? "{}") as Workspace;
    const savedB = JSON.parse(snaps.get("owner-b") ?? "{}") as Workspace;
    assert.equal(savedA.schedules[0]?.nextRunAt, "2026-04-01T13:00:00.000Z");
    assert.equal(savedA.schedules[0]?.lastStatus, "ran");
    assert.equal(savedA.audit[0]?.action, "schedule_ran");
    assert.equal(savedB.schedules[0]?.nextRunAt, "2026-04-02T12:00:00.000Z");
    const second = await runWorkerPass(sql, "2026-04-01T12:00:00.000Z", "worker-b");
    assert.equal(second.ran, 0);
  });

  it("claims before running so a second worker skips, and an expired lease can be recovered", () => {
    const due = job({ id: "job-1", name: "Morning", nextRunAt: "2026-04-01T12:00:00.000Z" });
    const first = claimSchedules([due], "2026-04-01T12:00:00.000Z", "worker-a");
    assert.deepEqual(first.claimed, ["job-1"]);
    const second = claimSchedules(first.jobs, "2026-04-01T12:00:30.000Z", "worker-b");
    assert.deepEqual(second.claimed, []);
    assert.deepEqual(second.skipped, ["job-1"]);
    const stale = [{ ...first.jobs[0]!, leaseUntil: "2026-04-01T12:00:00.000Z" }];
    const recovered = claimSchedules(stale, "2026-04-01T12:02:00.000Z", "worker-b");
    assert.deepEqual(recovered.recovered, ["job-1"]);
    assert.deepEqual(recovered.claimed, ["job-1"]);
    const off = claimSchedules([job({ id: "job-3", name: "Off", nextRunAt: "2026-04-01T12:00:00.000Z", enabled: false })], "2026-04-01T12:00:00.000Z", "worker-a");
    assert.equal(off.claimed.length, 0);
  });

  it("marks an unconfigured executor as failed instead of claiming the job ran", async () => {
    const due = emptyWorkspace();
    due.schedules.push(job({ id: "job-no-executor", name: "No executor", nextRunAt: "2026-04-01T12:00:00.000Z" }));
    const { sql, snaps } = db([{ userId: "owner-a", ws: due }]);
    const result = await runWorkerPass(sql, "2026-04-01T12:00:00.000Z", "worker-a");
    assert.equal(result.ran, 0);
    assert.equal(result.failed, 1);
    const saved = JSON.parse(snaps.get("owner-a") ?? "{}") as Workspace;
    assert.equal(saved.schedules[0]?.lastStatus, "failed");
    assert.equal(saved.schedules[0]?.lastError, "No schedule executor is configured. This job was not run.");
    assert.equal(saved.audit[0]?.action, "schedule_failed");
  });

  it("records a failure and does not mark the job completed", async () => {
    const due = emptyWorkspace();
    due.schedules.push(job({ id: "job-1", name: "Morning", nextRunAt: "2026-04-01T12:00:00.000Z" }));
    const { sql, snaps } = db([{ userId: "owner-a", ws: due }]);
    let sawClaim = false;
    const result = await runWorkerPass(sql, "2026-04-01T12:00:00.000Z", "worker-a", () => {
      const saved = JSON.parse(snaps.get("owner-a") ?? "{}") as Workspace;
      sawClaim = saved.schedules[0]?.leaseWorker === "worker-a";
      return { ok: false, detail: "The action failed." };
    });
    assert.equal(sawClaim, true);
    assert.equal(result.failed, 1);
    assert.equal(result.ran, 0);
    const saved = JSON.parse(snaps.get("owner-a") ?? "{}") as Workspace;
    assert.equal(saved.schedules[0]?.lastStatus, "failed");
    assert.equal(saved.schedules[0]?.lastError, "The action failed.");
    assert.equal(saved.audit[0]?.action, "schedule_failed");
    assert.notEqual(saved.schedules[0]?.nextRunAt, "2026-04-01T12:00:00.000Z");
  });
});
