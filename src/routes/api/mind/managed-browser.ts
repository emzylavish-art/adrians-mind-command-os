import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { DEV_USER_ID, requireUserId } from "@/lib/auth/verify.server";
import { sessionErrorStatus } from "@/lib/auth/session-resolution";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { readJsonObjectBody } from "@/lib/mind/request-body";
import { managedBrowserAction, managedBrowserId } from "@/lib/mind/managed-browser";
import { configuredManagedBrowser, managedBrowserReceipts, runManagedBrowserAction, savedManagedBrowser } from "@/lib/mind/managed-browser.server";

const json = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

async function handle(request: Request) {
  if (!assertSameOrigin(request).ok) return json({ error: "Open this action inside Adrian." }, 403);
  let owner: string;
  try { owner = await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")); }
  catch (error) { return json({ error: "Sign in to manage a browser." }, sessionErrorStatus(error)); }
  if (owner === DEV_USER_ID) return json({ error: "Sign in to manage a browser." }, 401);
  const worker = configuredManagedBrowser();
  if (!worker) return request.method === "GET" ? json({ origins: [], session: null })
    : json({ error: "The managed browser worker is unconfigured." }, 503);
  try {
    const sql = await getSql();
    if (request.method === "GET") {
      const session = await savedManagedBrowser(sql, owner);
      return json({ origins: worker.origins, session, receipts: session ? await managedBrowserReceipts(sql, owner, session.id) : [] });
    }
    const payload = await readJsonObjectBody(request, 2048);
    if (!payload.ok) return json({ error: payload.error }, payload.status);
    if (payload.body.owner !== owner) return json({ error: "Your active account changed. Reopen Browser Settings." }, 409);
    const action = managedBrowserAction(payload.body.action);
    if (!action) return json({ error: "Choose a supported managed browser action." }, 400);
    if (action.kind === "start" && !worker.origins.includes(action.origin)) return json({ error: "This site is outside the approved browser scope." }, 403);
    const id = payload.body.id;
    if (action.kind !== "start" && !managedBrowserId(id)) return json({ error: "Choose a managed browser session." }, 400);
    const result = await runManagedBrowserAction(sql, owner, typeof id === "string" ? id : null, action, worker.send);
    return json({ ...result, receipts: result.session ? await managedBrowserReceipts(sql, owner, result.session.id) : undefined }, result.status);
  } catch { return json({ error: "Managed browser storage could not verify this operation." }, 503); }
}

export const Route = createFileRoute("/api/mind/managed-browser")({
  server: { handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) } },
});
