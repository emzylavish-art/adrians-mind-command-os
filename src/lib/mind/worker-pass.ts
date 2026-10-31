import type { Sql } from "../db.ts";
import type { TickLease } from "./schedule-worker.ts";
import { tickSchedules } from "./schedule-worker.ts";
import { writeSnapshot } from "./store.ts";
import type { AuditEntry, Workspace } from "./types.ts";
import { normalizeWorkspace } from "./workspace.ts";

export type WorkerPass = { owners: number; ran: number; skipped: number; failed: number };

export async function runWorkerPass(sql: Sql, now: string, workerId: string, leases: Map<string, TickLease>): Promise<WorkerPass> {
  const rows = await sql<{ user_id: string; payload: unknown }>`select user_id, payload from mind_snapshot`;
  const summary: WorkerPass = { owners: rows.length, ran: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) as unknown : row.payload;
    const ws = normalizeWorkspace(payload);
    const ticked = tickSchedules(
      ws.schedules.map((job) => ({
        id: job.id,
        ownerId: row.user_id,
        enabled: job.enabled,
        nextRunAt: job.nextRunAt,
        intervalMinutes: job.intervalMinutes,
        timeZone: job.timeZone || "UTC",
        clockHour: job.clockHour,
        clockMinute: job.clockMinute,
      })),
      now,
      workerId,
      leases,
      (job) => ({ ok: true, detail: `Queued ${job.id}. No model was called.` }),
    );
    if (ticked.results.length === 0) continue;
    const byId = new Map(ticked.jobs.map((job) => [job.id, job]));
    const schedules = ws.schedules.map((job) => {
      const next = byId.get(job.id);
      const result = ticked.results.find((item) => item.id === job.id);
      if (!next || !result || result.status === "skipped") return job;
      return { ...job, nextRunAt: next.nextRunAt, lastRunAt: now, lastError: result.status === "failed" ? result.detail : "" };
    });
    const audit: AuditEntry[] = ticked.results.map((result) => ({
      id: `audit-${result.id}-${now}`,
      at: now,
      action: "schedule_tick",
      target: result.id,
      result: result.detail,
    }));
    const nextWs: Workspace = { ...ws, schedules, audit: [...audit, ...ws.audit].slice(0, 200) };
    await writeSnapshot(sql, row.user_id, nextWs);
    for (const result of ticked.results) summary[result.status] += 1;
  }
  return summary;
}
