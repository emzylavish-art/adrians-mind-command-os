import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sql } from "../db.ts";
import type { Workspace } from "./types.ts";
import { emptyWorkspace } from "./workspace.ts";
import { runWorkerPass } from "./worker-pass.ts";

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
    due.schedules.push({ id: "job-1", name: "Morning", agentId: null, intervalMinutes: 60, nextRunAt: "2026-04-01T12:00:00.000Z", lastRunAt: null, enabled: true, lastError: "", timeZone: "UTC", clockHour: null, clockMinute: null });
    const later = emptyWorkspace();
    later.schedules.push({ id: "job-2", name: "Later", agentId: null, intervalMinutes: 60, nextRunAt: "2026-04-02T12:00:00.000Z", lastRunAt: null, enabled: true, lastError: "", timeZone: "UTC", clockHour: null, clockMinute: null });
    const { sql, snaps } = db([{ userId: "owner-a", ws: due }, { userId: "owner-b", ws: later }]);
    const first = await runWorkerPass(sql, "2026-04-01T12:00:00.000Z", "worker-a", new Map());
    assert.equal(first.ran, 1);
    assert.equal(first.owners, 2);
    const savedA = JSON.parse(snaps.get("owner-a") ?? "{}") as Workspace;
    const savedB = JSON.parse(snaps.get("owner-b") ?? "{}") as Workspace;
    assert.equal(savedA.schedules[0]?.nextRunAt, "2026-04-01T13:00:00.000Z");
    assert.equal(savedA.audit[0]?.action, "schedule_tick");
    assert.equal(savedB.schedules[0]?.nextRunAt, "2026-04-02T12:00:00.000Z");
    const second = await runWorkerPass(sql, "2026-04-01T12:00:00.000Z", "worker-b", new Map());
    assert.equal(second.ran, 0);
  });
});
