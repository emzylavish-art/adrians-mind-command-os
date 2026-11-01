import { createFileRoute } from "@tanstack/react-router";
import { exchangeNotionCode } from "@/lib/mind/connectors/notion-oauth";

function html(message: string, ok: boolean) {
  const title = ok ? "Notion connected" : "Notion connect failed";
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui;padding:2rem"><h1>${title}</h1><p>${message}</p><p><a href="/">Back to app</a></p><script>try{window.opener&&window.opener.postMessage({type:"notion-oauth",ok:${ok}},"*")}catch(e){}</script></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/mind/oauth/notion/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        const err = url.searchParams.get("error");
        if (err) return html(`Notion returned error: ${err}. Nothing was stored.`, false);
        if (!code || !state) return html("Missing code or state. Nothing was stored.", false);
        const result = await exchangeNotionCode({ code, state });
        if (!result.ok) return html(result.error, false);
        return html(result.public.detail, true);
      },
    },
  },
});
