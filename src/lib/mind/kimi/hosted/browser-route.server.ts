import { machineRequired } from "../account-workspace.ts";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { closeCodingBrowser, codingBrowserFrame, codingBrowserStatus, ensureCodingBrowser } from "./web-browser.server";

const headers = { "cache-control": "no-store" };
export async function handleCodingBrowser(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    const origin = assertSameOrigin(request);
    if (!origin.ok) return Response.json({ ok: false, error: origin.error }, { status: 403, headers });
  }
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  let owner: string;
  try { owner = await requireUserId(bearer); }
  catch { return Response.json({ ok: false, error: "Sign in is required." }, { status: 401, headers }); }

  if (request.method === "GET" && url.searchParams.get("view") !== "frame") {
    return Response.json({ ok: true, ...codingBrowserStatus(owner), loginRequired: false }, { headers });
  }
  if (owner !== "dev-user") return Response.json({ ok: false, error: machineRequired }, { status: 409, headers });
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return Response.json({ ok: false, error: "Open the coding browser from Mind OS on this computer." }, { status: 409, headers });
  }
  if (request.method === "GET") {
    const frame = await codingBrowserFrame(owner);
    if (!frame) return Response.json({ ok: false, error: "Start the coding browser to open its frame." }, { status: 409, headers });
    return new Response(frame, { headers: { ...headers, "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer" } });
  }
  if (request.method === "DELETE") {
    const closed = await closeCodingBrowser(owner);
    return Response.json({ ok: closed, closed }, { status: closed ? 200 : 409, headers });
  }
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers });
  const started = await ensureCodingBrowser(owner);
  return Response.json(started.ok ? { ...started, localOnly: true, loginRequired: false, frame: `${url.pathname}?view=frame` } : started, { status: started.ok ? 200 : 503, headers });
}
