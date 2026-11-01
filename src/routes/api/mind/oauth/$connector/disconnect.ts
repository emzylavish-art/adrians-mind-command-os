import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { disconnectConnector, isDynamicOauthConnector } from "@/lib/mind/connectors/connector-oauth";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/oauth/$connector/disconnect")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const connector = params.connector;
        if (!isDynamicOauthConnector(connector)) {
          return json({ ok: false, error: `Unknown OAuth connector: ${connector}` }, 404);
        }
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const status = await disconnectConnector(connector, { ownerId: userId });
          return json({ ok: true, ...status });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json(
            { ok: false, error: message === "Unauthorized" ? "Sign in is required." : message },
            message === "Unauthorized" ? 401 : 403,
          );
        }
      },
    },
  },
});
