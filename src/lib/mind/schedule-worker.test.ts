import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tickSchedules, type TickJob, type TickLease } from "./schedule-worker.ts";

const job: TickJob = {
  id: "job-1",
  ownerId: "owner-a",
  enabled: true,
  nextRunAt: "2026-04-01T12:00:00.000Z",
  intervalMinutes: 60,
  timeZone: "UTC",
  clockHour: null,
  clockMinute: null,
};

describe("schedule worker", () => {
  it("runs a due job once and a second worker does not run it again", () => {
    const leases = new Map<string, TickLease>();
    let runs = 0;
    const first = tickSchedules([job], "2026-04-01T12:00:00.000Z", "worker-a", leases, () => {
      runs += 1;
      return { ok: true, detail: "queued" };
    });
    assert.equal(runs, 1);
    assert.equal(first.results[0]?.status, "ran");
    assert.equal(first.jobs[0]?.nextRunAt, "2026-04-01T13:00:00.000Z");
    const second = tickSchedules([{ ...job, nextRunAt: "2026-04-01T12:00:00.000Z" }], "2026-04-01T12:00:30.000Z", "worker-b", leases, () => {
      runs += 1;
      return { ok: true, detail: "should not run" };
    });
    assert.equal(runs, 1);
    assert.equal(second.results[0]?.status, "skipped");
  });

  it("does not run another owner's job and does not catch up a missed interval more than once", () => {
    const leases = new Map<string, TickLease>();
    const missed = { ...job, nextRunAt: "2026-04-01T08:00:00.000Z" };
    const other = { ...job, id: "job-2", ownerId: "owner-b", nextRunAt: "2026-04-02T00:00:00.000Z" };
    const seen: string[] = [];
    const ticked = tickSchedules([missed, other], "2026-04-01T12:00:00.000Z", "worker-a", leases, (item) => {
      seen.push(item.ownerId);
      return { ok: true, detail: "once" };
    });
    assert.deepEqual(seen, ["owner-a"]);
    assert.equal(ticked.jobs[0]?.nextRunAt, "2026-04-01T13:00:00.000Z");
    assert.equal(ticked.jobs[1]?.nextRunAt, other.nextRunAt);
  });
});
