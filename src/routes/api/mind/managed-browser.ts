import { createFileRoute } from "@tanstack/react-router";
import { DEV_USER_ID, requireUserId } from "@/lib/auth/verify.server";
import { sessionErrorStatus } from "@/lib/auth/session-resolution";
import { getSql } from "@/lib/db";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { readJsonObjectBody } from "@/lib/mind/request-body";
import { managedBrowserRequest } from "@/lib/mind/managed-browser.server";

const reply = (body: object, status: number) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

async function handle(request: Request) {
  if (!assertSameOrigin(request).ok) return reply({ error: "Open this action inside Adrian." }, 403);
  let owner: string;
  try { owner = await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")); }
  catch (error) { return reply({ error: "Sign in to use the managed browser." }, sessionErrorStatus(error)); }
  if (owner === DEV_USER_ID) return reply({ error: "Sign in to use the managed browser." }, 401);
  try {
    const parsed = await readJsonObjectBody(request, 4096);
    if (!parsed.ok) return reply({ error: parsed.error }, parsed.status);
    if (parsed.body.owner !== owner) return reply({ error: "The account changed. Reopen the browser." }, 409);
    const result = await managedBrowserRequest(await getSql(), owner, parsed.body);
    return reply(result.body, result.status);
  } catch {
    return reply({ error: "Browser storage could not confirm this action. Reload the saved session." }, 503);
  }
}

export const Route = createFileRoute("/api/mind/managed-browser")({ server: { handlers: { POST: ({ request }) => handle(request) } } });
