import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import {
  notionConnectionStatus,
  notionOAuthConfigured,
  readNotionOAuthEnv,
} from "@/lib/mind/connectors/notion-oauth";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/mind/oauth/notion/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const env = readNotionOAuthEnv();
          // No Notion OAuth secrets on this host → honest Not configured.
          // Do not require sign-in just to report that the connector is absent.
          if (!notionOAuthConfigured(env)) {
            const status = notionConnectionStatus("anonymous", env);
            return json({
              ok: true,
              state: status.state,
              detail: status.detail,
              workspaceName: status.workspaceName,
              accountLabel: status.accountLabel,
              connectedAt: status.connectedAt,
            });
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
              // Configured but signed out: not an outage — ask for sign-in.
              return json({
                ok: true,
                state: "not_connected",
                detail: "Sign in to see Notion connection status. Nothing was connected.",
              });
            }
            return json({
              ok: true,
              state: "not_configured",
              detail:
                "Notion connection status could not be verified on this host. Treated as not configured.",
            });
          }

          const status = notionConnectionStatus(userId, env);
          return json({
            ok: true,
            state: status.state,
            detail: status.detail,
            workspaceName: status.workspaceName,
            accountLabel: status.accountLabel,
            connectedAt: status.connectedAt,
          });
        } catch {
          // Cloudflare / filesystem / crypto surprises → honest terminal state.
          return json({
            ok: true,
            state: "not_configured",
            detail:
              "Notion OAuth is not available on this host. Nothing was connected.",
          });
        }
      },
    },
  },
});
