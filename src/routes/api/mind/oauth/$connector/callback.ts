import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { exchangeConnectorCode, isDynamicOauthConnector } from "@/lib/mind/connectors/connector-oauth";
import { CONNECTOR_DISPLAY_NAMES } from "@/lib/mind/connectors/store";
import { oauthCallbackHtml, oauthProviderErrorMessage } from "@/lib/mind/connectors/oauth-callback-html";

export const Route = createFileRoute("/api/mind/oauth/$connector/callback")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const connector = params.connector;
        if (!isDynamicOauthConnector(connector)) {
          return oauthCallbackHtml({
            connector: "unknown",
            message: "Unknown OAuth connector. Nothing was stored.",
            ok: false,
          });
        }
        const label = CONNECTOR_DISPLAY_NAMES[connector];
        const url = new URL(request.url);
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        const err = url.searchParams.get("error");
        if (err) {
          return oauthCallbackHtml({
            connector,
            message: oauthProviderErrorMessage(label, err),
            ok: false,
          });
        }
        if (!code || !state) {
          return oauthCallbackHtml({
            connector,
            message: "Missing code or state. Nothing was stored.",
            ok: false,
          });
        }
        let expectedOwnerId: string | undefined;
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          expectedOwnerId = await requireUserId(bearer);
        } catch {
          return oauthCallbackHtml({
            connector,
            message: "Sign in is required to finish connecting. Nothing was stored.",
            ok: false,
          });
        }
        const result = await exchangeConnectorCode(connector, { code, state, expectedOwnerId });
        if (!result.ok) return oauthCallbackHtml({ connector, message: result.error, ok: false });
        return oauthCallbackHtml({ connector, message: result.public.detail, ok: true });
      },
    },
  },
});
