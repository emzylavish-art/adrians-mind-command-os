import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { disconnectNotion } from "@/lib/mind/connectors/notion-oauth";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/oauth/notion/disconnect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const status = await disconnectNotion({ ownerId: userId });
          return json({
            ok: true,
            state: status.state,
            detail: status.detail,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
    },
  },
});
