import { createFileRoute } from "@tanstack/react-router";
import { buildDashboardStatus } from "@/lib/mind/dashboard/status";
import { publicizeDashboardStatus } from "@/lib/mind/dashboard/status-publicize";
import { dashboardStatusServerCache } from "@/lib/mind/dashboard/status-server-cache";
import { botDetailFromStatus, slimDashboardStatusForPoll } from "@/lib/mind/dashboard/status-summary";

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-encoding": "identity",
      "vary": "Accept-Encoding",
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

async function handleGet({ request }: { request: Request }) {
  try {
    const url = new URL(request.url);
    const full = url.searchParams.get("full") === "1";
    const botId = url.searchParams.get("bot")?.trim() || "";
    const status = await dashboardStatusServerCache.get(async () => {
      const built = await buildDashboardStatus();
      return publicizeDashboardStatus(built);
    });
    if (botId) {
      const detail = botDetailFromStatus(status as never, botId);
      // Always attach a slim poll body so clients can refresh HUD without a second round-trip.
      const slim = slimDashboardStatusForPoll(status as Record<string, unknown>);
      return json({ ok: true, ...slim, botDetail: detail });
    }
    if (full) {
      return json({ ok: true, ...(status as object), summary: { mode: "full", botDetailPath: "/api/mind/dashboard/status?bot=" } });
    }
    // Gap#59 default: summary poll (~gzip-friendly, excerpts stripped).
    const slim = slimDashboardStatusForPoll(status as Record<string, unknown>);
    return json({ ok: true, ...slim });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, 500);
  }
}

export const Route = createFileRoute("/api/mind/dashboard/status")({
  server: {
    handlers: {
      GET: handleGet,
      POST: async () => methodNotAllowed(),
      PUT: async () => methodNotAllowed(),
      PATCH: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
      OPTIONS: async () => methodNotAllowed(),
    },
  },
});
