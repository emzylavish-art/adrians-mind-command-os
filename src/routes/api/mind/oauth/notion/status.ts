import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { oauthStatusFailure } from "@/lib/mind/connectors/status-http";
import { notionConnectionStatusPersistent } from "@/lib/mind/connectors/notion-oauth";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/oauth/notion/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const status = await notionConnectionStatusPersistent(userId);
          return json({
            ok: true,
            state: status.state,
            detail: status.detail,
            workspaceName: status.workspaceName,
            accountLabel: status.accountLabel,
            connectedAt: status.connectedAt,
          });
        } catch (error) {
          const failure = oauthStatusFailure(error);
          return json(failure.body, failure.status);
        }
      },
    },
  },
});
