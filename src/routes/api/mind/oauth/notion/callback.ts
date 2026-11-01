import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { exchangeNotionCode } from "@/lib/mind/connectors/notion-oauth";
import { oauthCallbackHtml, oauthProviderErrorMessage } from "@/lib/mind/connectors/oauth-callback-html";

export const Route = createFileRoute("/api/mind/oauth/notion/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        const err = url.searchParams.get("error");
        if (err) {
          return oauthCallbackHtml({
            connector: "notion",
            message: oauthProviderErrorMessage("Notion", err),
            ok: false,
          });
        }
        if (!code || !state) {
          return oauthCallbackHtml({
            connector: "notion",
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
            connector: "notion",
            message: "Sign in is required to finish connecting. Nothing was stored.",
            ok: false,
          });
        }
        const result = await exchangeNotionCode({ code, state, expectedOwnerId });
        if (!result.ok) return oauthCallbackHtml({ connector: "notion", message: result.error, ok: false });
        return oauthCallbackHtml({ connector: "notion", message: result.public.detail, ok: true });
      },
    },
  },
});
