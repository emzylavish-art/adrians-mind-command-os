import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { buildNotionAuthorizeUrl } from "@/lib/mind/connectors/notion-oauth";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/oauth/notion/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const wantsJson = request.headers.get("accept")?.includes("application/json") || new URL(request.url).searchParams.get("format") === "json";
          const started = buildNotionAuthorizeUrl({ ownerId: userId });
          if (!started.ok) return json({ ok: false, error: started.error, state: "not_configured" }, 400);
          if (wantsJson) return json({ ok: true, url: started.url, state: started.state });
          return Response.redirect(started.url, 302);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
    },
  },
});
