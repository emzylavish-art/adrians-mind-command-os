import { createFileRoute } from "@tanstack/react-router";
import { buildDashboardStatus } from "@/lib/mind/dashboard/status";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-frame-options": "DENY",
    },
  });
}

/**
 * Public read-only status snapshot for the public dashboard.
 * No credentials, tokens, or mutation endpoints are exposed by this route.
 * Keep no-store because operational state changes frequently.
 */
export const Route = createFileRoute("/api/mind/dashboard/status")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const status = await buildDashboardStatus();
          // Public dashboard telemetry must never disclose host filesystem paths or raw lock payloads.
          const publicStatus = {
            ...status,
            bots: status.bots.map((bot) => ({
              ...bot,
              lock: bot.lock ? {
                branch: bot.lock.branch,
                status: bot.lock.status,
                claimed_at: bot.lock.claimed_at,
                released_at: bot.lock.released_at,
                commits: bot.lock.commits,
                notes: bot.lock.notes,
              } : null,
            })),
            orchestrator: {
              owner: status.orchestrator.owner,
              status: status.orchestrator.status,
              branch: status.orchestrator.branch,
              claimed_at: status.orchestrator.claimed_at,
              notes: status.orchestrator.notes,
              lockFile: null,
            },
            sources: {
              locksOk: status.sources.locksOk,
              gitOk: status.sources.gitOk,
              commitsSource: status.sources.commitsSource,
              commitsSnapshotAt: status.sources.commitsSnapshotAt,
            },
          };
          return json({ ok: true, ...publicStatus });
        } catch {
          // Do not leak internal paths, provider details, or runtime errors.
          return json({ ok: false, error: "Unable to load dashboard status." }, 500);
        }
      },
    },
  },
});
