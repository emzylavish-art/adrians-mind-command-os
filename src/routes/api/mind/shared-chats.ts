import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { DEV_USER_ID, requireUserId } from "@/lib/auth/verify.server";
import { sessionErrorStatus } from "@/lib/auth/session-resolution";
import { getSql } from "@/lib/db";
import { parsedPayload, readSnapshot } from "@/lib/mind/store";
import { normalizeWorkspace } from "@/lib/mind/workspace";
import { chatTextDigest, shareableChatText } from "@/lib/mind/chat-share";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { readJsonObjectBody } from "@/lib/mind/request-body";

const hex = /^[0-9a-f]{64}$/;
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
const unavailable = () => reply({ error: "This link is unavailable. Its owner may have revoked it or changed the conversation." }, 404);
function snapshotText(snapshot: unknown, id: string) {
  const chat = normalizeWorkspace(snapshot).chats.find(row => row.id === id);
  return chat && shareableChatText(chat);
}

async function handle(request: Request) {
  if (request.method === "POST" && !assertSameOrigin(request).ok) return reply({ error: "Open this action inside Adrian." }, 403);
  let owner: string;
  try { owner = await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")); }
  catch (error) { return reply({ error: "Sign in to access shared conversations." }, sessionErrorStatus(error)); }
  if (owner === DEV_USER_ID) return reply({ error: "Sign in with an account to use shared links." }, 401);
  try {
    const sql = await getSql();
    if (request.method === "GET") {
      const links = await sql.query("select link_hash as id, chat_id as \"chatId\", created_at as \"createdAt\" from mind_chat_shared_link where owner_id=$1 and revoked_at is null order by created_at desc", [owner]);
      return reply({ owner, links });
    }
    const parsed = await readJsonObjectBody(request, 2048);
    if (!parsed.ok) return reply({ error: parsed.error }, parsed.status);
    const { action, id, token, chatId, digest, ownerId } = parsed.body;
    if (action !== "open" && ownerId !== owner) return reply({ error: "The account changed. Reopen Settings." }, 409);
    if (action === "revoke" && typeof id === "string" && hex.test(id)) {
      const rows = await sql.query("update mind_chat_shared_link set revoked_at=coalesce(revoked_at, now()) where owner_id=$1 and link_hash=$2 returning link_hash as id", [owner, id]);
      return rows.length ? reply({ revoked: id }) : unavailable();
    }
    if (typeof token !== "string" || !hex.test(token)) return unavailable();
    const hash = createHash("sha256").update(token).digest("hex");
    if (action === "open") {
      const [row] = await sql.query<{ payload: unknown; chat_id: string; content_hash: string }>(
        "select s.payload,l.chat_id,l.content_hash from mind_chat_shared_link l join mind_snapshot s on s.user_id=l.owner_id where l.link_hash=$1 and l.revoked_at is null", [hash]);
      const text = row && snapshotText(parsedPayload(row.payload), row.chat_id);
      return text && await chatTextDigest(text) === row.content_hash ? reply({ text }) : unavailable();
    }
    if (action !== "create" || typeof chatId !== "string" || chatId.length > 200 || typeof digest !== "string" || !hex.test(digest)) return reply({ error: "Review a saved conversation first." }, 400);
    const text = snapshotText(await readSnapshot(sql, owner), chatId);
    if (!text || await chatTextDigest(text) !== digest) return reply({ error: "The saved text differs from your preview. Sync the conversation and review again." }, 409);
    const rows = await sql.query("insert into mind_chat_shared_link (link_hash,owner_id,chat_id,content_hash) values ($1,$2,$3,$4) on conflict (link_hash) do update set chat_id=excluded.chat_id where mind_chat_shared_link.owner_id=excluded.owner_id and mind_chat_shared_link.chat_id=excluded.chat_id and mind_chat_shared_link.content_hash=excluded.content_hash and mind_chat_shared_link.revoked_at is null returning link_hash as id", [hash, owner, chatId, digest]);
    return rows.length ? reply({ created: hash }) : reply({ error: "This link attempt can no longer be used. Review the conversation again." }, 409);
  } catch { return reply({ error: "Shared links are unavailable. Retry to confirm the current state." }, 503); }
}

export const Route = createFileRoute("/api/mind/shared-chats")({ server: { handlers: {
  GET: ({ request }) => handle(request), POST: ({ request }) => handle(request),
} } });
