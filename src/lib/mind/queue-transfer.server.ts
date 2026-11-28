import { createHash } from "node:crypto";
import type { Sql } from "../db.ts";
import { QUEUE_TRANSFER_LIMIT, readTransferScope, transferIdPattern, transferableCue } from "./queue-transfer.ts";
import { normalizeWorkspace } from "./workspace";
import { parsedPayload, readSnapshot } from "./store";

type TransferRow = { cue_id: string; state: "waiting" | "claimed" | "received" | "cancelled"; claim_id: string | null; payload: unknown; digest: string };
const issue = (status: number, error: string) => ({ status, body: { error } });
const success = (body: object) => ({ status: 200, body });

export async function runQueueTransfer(sql: Sql, owner: string, input: Record<string, unknown>) {
  const scope = readTransferScope(input.scope);
  if (!scope) return issue(400, "Choose the original queue.");
  const action = input.action;
  const needsActiveScope = action === "list" || action === "save" || action === "claim";
  if (needsActiveScope && "id" in scope && scope.id !== null) {
    const ws = normalizeWorkspace(await readSnapshot(sql, owner));
    const allowed = scope.kind === "chat"
      ? ws.chats.some(chat => chat.id === scope.id && !chat.temporary && !chat.archived) && !ws.deletedChatIds?.includes(scope.id)
      : ws.projects.some(project => project.id === scope.id && !project.archived && project.lifecycle !== "archived");
    if (!allowed) return issue(409, "Save and reopen the original active conversation or project before transferring a draft.");
  }
  const destination = JSON.stringify(scope);
  if (action === "list") {
    const rows = await sql.query<{ id: string; state: string; createdAt: unknown }>(
      "select cue_id as id,state,created_at as \"createdAt\" from mind_composer_queue_transfer where user_id=$1 and scope=$2 and state in ('waiting','claimed') order by created_at,cue_id",
      [owner, destination]);
    return success({ items: rows });
  }
  if (action === "save") {
    const item = transferableCue(input.item);
    if (!item) return issue(400, "Only held drafts with available attachments can be saved for another device.");
    const payload = JSON.stringify(item);
    if (Buffer.byteLength(payload) > QUEUE_TRANSFER_LIMIT - 1024) return issue(413, "This draft is too large for device transfer. Its local copy was kept.");
    if (!sql.transaction) return issue(503, "Queue storage is unavailable.");
    const digest = createHash("sha256").update(payload).digest("hex");
    return sql.transaction(async tx => {
      const account = await tx.query('select id from "user" where id=$1 for update', [owner]);
      if (!account.length) return issue(401, "Sign in again to transfer drafts.");
      const [existing] = await tx.query<TransferRow>(
        "select state,digest from mind_composer_queue_transfer where user_id=$1 and scope=$2 and cue_id=$3",
        [owner, destination, item.id]);
      if (existing) return existing.state === "waiting" && existing.digest === digest
        ? success({ saved: item.id })
        : issue(409, "That draft was already transferred or changed. Queue a new copy if you intend to send it again.");
      const [count] = await tx.query<{ total: number; scoped: number }>("select count(*)::int as total,count(*) filter (where scope=$2)::int as scoped from mind_composer_queue_transfer where user_id=$1 and state in ('waiting','claimed')", [owner, destination]);
      if (count.total >= 24 || count.scoped >= 8) return issue(409, "The device queue is full. Recover or remove a saved draft first.");
      await tx.query("insert into mind_composer_queue_transfer (user_id,scope,cue_id,payload,digest) values ($1,$2,$3,$4::jsonb,$5)", [owner, destination, item.id, payload, digest]);
      return success({ saved: item.id });
    });
  }
  const id = input.id;
  if (typeof id !== "string" || !transferIdPattern.test(id)) return issue(400, "Choose a saved draft.");
  const key = [owner, destination, id];
  const claim = input.claimId;
  if (action === "cancel") {
    const rows = await sql.query("update mind_composer_queue_transfer set state='cancelled',payload=null where user_id=$1 and scope=$2 and cue_id=$3 and state in ('waiting','claimed','cancelled') returning cue_id", key);
    return rows.length ? success({ cancelled: id }) : issue(409, "This draft is unavailable or belongs to an active recovery claim.");
  }
  if (typeof claim !== "string" || !transferIdPattern.test(claim)) return issue(400, "Reopen this device’s recovery panel.");
  if (action === "claim") {
    const [row] = await sql.query<TransferRow>("update mind_composer_queue_transfer set state='claimed',claim_id=$4 where user_id=$1 and scope=$2 and cue_id=$3 and (state='waiting' or (state='claimed' and claim_id=$4)) returning payload", [...key, claim]);
    const item = row && transferableCue(parsedPayload(row.payload));
    return item ? success({ item }) : issue(409, "This draft is unavailable or is being recovered on another device.");
  }
  if (action === "finish") {
    const rows = await sql.query("update mind_composer_queue_transfer set state='received',payload=null where user_id=$1 and scope=$2 and cue_id=$3 and state in ('claimed','received') and claim_id=$4 returning cue_id", [...key, claim]);
    return rows.length ? success({ received: id }) : issue(409, "This device’s recovery claim could not be confirmed.");
  }
  return issue(400, "Choose a supported device queue action.");
}
