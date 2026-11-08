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
          return json({ ok: true, ...status });
        } catch {
          // Do not leak internal paths, provider details, or runtime errors.
          return json({ ok: false, error: "Unable to load dashboard status." }, 500);
        }
      },
    },
  },
});
