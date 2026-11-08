import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { getYoutubeOverview } from "@/lib/mind/connectors/youtube-api";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}

export const Route = createFileRoute("/api/mind/youtube/overview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ")
            ? authorization.slice(7).trim()
            : undefined;
          const ownerId = await requireUserId(bearer);
          const rawDays = Number(new URL(request.url).searchParams.get("days") || 28);
          const days = Number.isFinite(rawDays) ? Math.max(7, Math.min(365, Math.floor(rawDays))) : 28;
          const overview = await getYoutubeOverview(ownerId, days);
          return json({ ok: true, ...overview });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to load YouTube analytics.";
          const status = message.includes("Sign in") || message === "Unauthorized" ? 401 : 400;
          return json({ ok: false, error: message }, status);
        }
      },
    },
  },
});
