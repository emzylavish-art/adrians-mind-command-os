import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import {
  connectorConnectionStatus,
  isDynamicOauthConnector,
} from "@/lib/mind/connectors/connector-oauth";
import { getProvider } from "@/lib/mind/connectors/providers";
import { providerConfigured } from "@/lib/mind/connectors/oauth-provider";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
          const provider = getProvider(connector);
          const env = provider.readEnv();
          if (!providerConfigured(env)) {
            const status = connectorConnectionStatus(connector, "anonymous", env);
            return json({ ok: true, ...status });
          }

          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ")
            ? authorization.slice(7).trim()
            : undefined;
          let userId: string;
          try {
            userId = await requireUserId(bearer);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unauthorized";
            if (message === "Unauthorized") {
              return json({
                ok: true,
                state: "not_connected",
                detail: `Sign in to see ${provider.displayName} connection status. Nothing was connected.`,
              });
            }
            return json({
              ok: true,
              state: "not_configured",
              detail: `${provider.displayName} connection status could not be verified on this host. Treated as not configured.`,
            });
          }

          const status = connectorConnectionStatus(connector, userId, env);
          return json({ ok: true, ...status });
        } catch {
          return json({
            ok: true,
            state: "not_configured",
            detail: "OAuth is not available on this host. Nothing was connected.",
          });
        }
      },
    },
  },
});
