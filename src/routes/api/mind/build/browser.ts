import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { codingBrowserFrame, codingBrowserStatus, ensureCodingBrowser } from "@/lib/mind/kimi/hosted/web-browser.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function handleBrowser(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST") {
    const origin = assertSameOrigin(request);
    if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
  }
  if (request.method !== "GET" && request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    const authorization = request.headers.get("authorization");
    const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
    await requireUserId(bearer);
  } catch {
    return json({ ok: false, error: "Sign in is required." }, 401);
  }

  if (request.method === "GET" && url.searchParams.get("view") !== "frame") {
    return json({ ok: true, ...codingBrowserStatus(), loginRequired: false });
  }
  const started = await ensureCodingBrowser();
  if (!started.ok || !started.port) return json({ ok: false, package: started.package, loginRequired: false, error: started.error }, 503);
  if (url.searchParams.get("view") === "frame") {
    return new Response(codingBrowserFrame(started.port), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
    });
  }
  return json({
    ok: true,
    package: started.package,
    localOnly: true,
    loginRequired: false,
    frame: "/api/mind/build/browser?view=frame",
  });
}

export const Route = createFileRoute("/api/mind/build/browser")({
  server: { handlers: { GET: ({ request }) => handleBrowser(request), POST: ({ request }) => handleBrowser(request) } },
});
