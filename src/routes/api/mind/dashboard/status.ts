import { createFileRoute } from "@tanstack/react-router";
import { buildDashboardStatus } from "@/lib/mind/dashboard/status";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/mind/dashboard/status")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const status = await buildDashboardStatus();
          return json({ ok: true, ...status });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return json({ ok: false, error: message }, 500);
        }
      },
    },
  },
});
