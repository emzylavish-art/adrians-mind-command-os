import { createFileRoute } from "@tanstack/react-router";
import { DEV_USER_ID, requireUserId } from "@/lib/auth/verify.server";
import { sessionErrorStatus } from "@/lib/auth/session-resolution";
import { getSql } from "@/lib/db";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { readJsonObjectBody } from "@/lib/mind/request-body";
import { QUEUE_TRANSFER_LIMIT } from "@/lib/mind/queue-transfer";
import { runQueueTransfer } from "@/lib/mind/queue-transfer.server";

const reply = (body: object, status: number) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

async function handle(request: Request) {
  if (!assertSameOrigin(request).ok) return reply({ error: "Open this action inside Adrian." }, 403);
  let owner: string;
  try { owner = await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")); }
  catch (error) { return reply({ error: "Sign in to transfer queued drafts." }, sessionErrorStatus(error)); }
  if (owner === DEV_USER_ID) return reply({ error: "Sign in to transfer queued drafts." }, 401);
  try {
    const parsed = await readJsonObjectBody(request, QUEUE_TRANSFER_LIMIT);
    if (!parsed.ok) return reply({ error: parsed.error }, parsed.status);
    if (parsed.body.owner !== owner) return reply({ error: "The account changed. Reopen the queue." }, 409);
    const result = await runQueueTransfer(await getSql(), owner, parsed.body);
    return reply(result.body, result.status);
  } catch {
    return reply({ error: "Device queue storage could not confirm this action. Your local draft was kept." }, 503);
  }
}

export const Route = createFileRoute("/api/mind/queue-transfer")({ server: { handlers: { POST: ({ request }) => handle(request) } } });
