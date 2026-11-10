import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { oauthStatusFailure } from "@/lib/mind/connectors/status-http";
import { connectorConnectionStatusPersistent, isDynamicOauthConnector } from "@/lib/mind/connectors/connector-oauth";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/oauth/$connector/status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const connector = params.connector;
        if (!isDynamicOauthConnector(connector)) {
          return json({ ok: false, error: `Unknown OAuth connector: ${connector}` }, 404);
        }
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const status = await connectorConnectionStatusPersistent(connector, userId);
          return json({ ok: true, ...status });
        } catch (error) {
          const failure = oauthStatusFailure(error);
          return json(failure.body, failure.status);
        }
      },
    },
  },
});
