import { createFileRoute } from "@tanstack/react-router";
import { exchangeConnectorCode, isDynamicOauthConnector } from "@/lib/mind/connectors/connector-oauth";
import { CONNECTOR_DISPLAY_NAMES } from "@/lib/mind/connectors/store";

function html(connector: string, message: string, ok: boolean) {
  const name = (CONNECTOR_DISPLAY_NAMES as Record<string, string>)[connector] || connector;
  const title = ok ? `${name} connected` : `${name} connect failed`;
  const type = `${connector}-oauth`;
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui;padding:2rem"><h1>${title}</h1><p>${message}</p><p><a href="/">Back to app</a></p><script>try{window.opener&&window.opener.postMessage({type:${JSON.stringify(type)},ok:${ok}},"*")}catch(e){}</script></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/mind/oauth/$connector/callback")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const connector = params.connector;
        if (!isDynamicOauthConnector(connector)) {
          return html(connector, `Unknown OAuth connector: ${connector}. Nothing was stored.`, false);
        }
        const url = new URL(request.url);
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        const err = url.searchParams.get("error");
        if (err) return html(connector, `Provider returned error: ${err}. Nothing was stored.`, false);
        if (!code || !state) return html(connector, "Missing code or state. Nothing was stored.", false);
        const result = await exchangeConnectorCode(connector, { code, state });
        if (!result.ok) return html(connector, result.error, false);
        return html(connector, result.public.detail, true);
      },
    },
  },
});
