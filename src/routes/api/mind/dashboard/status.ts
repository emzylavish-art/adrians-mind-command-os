import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { buildDashboardStatus } from "@/lib/mind/dashboard/status";
import { isMindOwnerId } from "@/lib/mind/dashboard/owner.server";

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

export const Route = createFileRoute("/api/mind/dashboard/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ")
            ? authorization.slice(7).trim()
            : undefined;
          const userId = await requireUserId(bearer);
          if (!isMindOwnerId(userId)) {
            return json({ ok: false, error: "Forbidden." }, 403);
          }
        } catch (error) {
          const unauthorized = error instanceof Error && error.message === "Unauthorized";
          return json(
            { ok: false, error: unauthorized ? "Sign in is required." : "Unable to verify session." },
            unauthorized ? 401 : 500,
          );
        }

        try {
          const status = await buildDashboardStatus();
          return json({ ok: true, ...status });
        } catch {
          // Do not leak internal paths, provider details, or runtime errors to clients.
          return json({ ok: false, error: "Unable to load dashboard status." }, 500);
        }
      },
    },
  },
});
