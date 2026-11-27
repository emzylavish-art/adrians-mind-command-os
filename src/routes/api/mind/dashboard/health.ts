import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { allowMindRequest } from "@/lib/mind/limits";
import { readFleet } from "@/lib/mind/fleet";
import { interpretWorkerHealth, type WorkerFile } from "@/lib/mind/worker-health";
import { buildOperationalHealth } from "@/lib/mind/dashboard/operational-health";
import { readFileSync } from "node:fs";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
export const Route = createFileRoute("/api/mind/dashboard/health")({
  server: { handlers: { GET: async ({ request }) => {
    let owner: string;
    try { owner = await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")); }
    catch { return reply({ ok: false, error: "Sign in to view operational health." }, 401); }
    if (owner === "dev-user") return reply({ ok: false, error: "Sign in to view operational health." }, 401);
    if (!allowMindRequest("dashboard_health", owner, 12)) return reply({ ok: false, error: "Wait before refreshing operational health." }, 429);
    const now = Date.now();
    let storageReadable = false;
    let payload: unknown = null;
    let snapshotUpdatedAt: string | null = null;
    try {
      const sql = await getSql();
      const rows = await sql<{ payload: unknown; updated_at: string | Date }>`select payload, updated_at from mind_snapshot where user_id = ${owner}`;
      payload = typeof rows[0]?.payload === "string" ? JSON.parse(rows[0].payload) : rows[0]?.payload ?? null;
      snapshotUpdatedAt = rows[0]?.updated_at ? new Date(rows[0].updated_at).toISOString() : null;
      storageReadable = true;
    } catch { /* Read failure remains distinct from a valid empty workspace. */ }
    let worker: WorkerFile | null = null;
    try { worker = JSON.parse(readFileSync(".data/worker-status.json", "utf8")) as WorkerFile; } catch { /* No heartbeat is not proof of a hosted worker. */ }
    const health = buildOperationalHealth({ now, runs: readFleet(payload).runs, storageReadable, snapshotUpdatedAt, worker: { ...interpretWorkerHealth(worker, now, 90_000), heartbeatAt: worker?.heartbeatAt ?? null }, revision: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null });
    return reply({ ok: true, health });
  } } },
});
