import { createFileRoute } from "@tanstack/react-router";
import { buildDashboardStatus } from "@/lib/mind/dashboard/status";
import { publicizeDashboardStatus } from "@/lib/mind/dashboard/status-publicize";
import { dashboardStatusServerCache } from "@/lib/mind/dashboard/status-server-cache";

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function methodNotAllowed() {
  return json(
    { ok: false, error: "method_not_allowed" },
    405,
    { allow: "GET" },
  );
}

async function handleGet() {
  try {
    const status = await dashboardStatusServerCache.get(async () => {
      const built = await buildDashboardStatus();
      return publicizeDashboardStatus(built);
    });
    return json({ ok: true, ...(status as object) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, 500);
  }
}

export const Route = createFileRoute("/api/mind/dashboard/status")({
  server: {
    handlers: {
      GET: handleGet,
      // Gap#29: explicit 405 (SPA fallback previously answered 200 HTML for POST/DELETE)
      POST: async () => methodNotAllowed(),
      PUT: async () => methodNotAllowed(),
      PATCH: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
    },
  },
});
