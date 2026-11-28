import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { approvedBrowserOrigins, type BrowserReply, type ManagedAction, type ManagedBrowserReceipt, type ManagedBrowserSession } from "./managed-browser.ts";

type Row = { id: string; origin: string; mode: ManagedBrowserSession["mode"]; operation: string; updated_at: string };
type Outcome = { reply?: BrowserReply; rejected?: boolean };
export type BrowserTransport = (id: string, operation: string, action: ManagedAction) => Promise<Outcome>;

function publicSession(row: Row): ManagedBrowserSession {
  return { id: row.id, origin: row.origin, mode: row.mode, operation: row.operation, updatedAt: row.updated_at };
}

export function configuredManagedBrowser(env = process.env, fetcher = fetch) {
  const token = env.ADRIAN_MANAGED_BROWSER_TOKEN;
  const origins = approvedBrowserOrigins(env.ADRIAN_MANAGED_BROWSER_ORIGINS);
  let endpoint: URL;
  try { endpoint = new URL(env.ADRIAN_MANAGED_BROWSER_URL ?? ""); } catch { return null; }
  const local = endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost" || endpoint.hostname === "[::1]";
  if ((!local && endpoint.protocol !== "https:") || !["http:", "https:"].includes(endpoint.protocol)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !origins.length || !token || token.length < 32) return null;
  const send: BrowserTransport = async (id, operation, action) => {
    try {
      const response = await fetcher(new URL("session/" + id + "/" + operation, endpoint.href.replace(/\/?$/, "/")), {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(19_000),
        headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(action),
      });
      if (!response.ok) return { rejected: response.status >= 400 && response.status < 500 && response.status !== 408 };
      const raw = await response.json();
      if (!["managed", "takeover", "stopped"].includes(raw?.mode)) return {};
      const frame = typeof raw.frame === "string" && raw.frame.length <= 460_000 && /^[A-Za-z0-9+/]+=*$/.test(raw.frame) ? raw.frame : undefined;
      return { reply: { mode: raw.mode, frame } };
    } catch { return {}; }
  };
  return { origins, send };
}

export async function savedManagedBrowser(sql: Sql, owner: string) {
  const [row] = await sql.query<Row>(`select id,origin,mode,operation,updated_at::text from mind_managed_browser
    where user_id=$1 order by (ended_at is null) desc, updated_at desc limit 1`, [owner]);
  return row ? publicSession(row) : null;
}

export function managedBrowserReceipts(sql: Sql, owner: string, session: string) {
  return sql.query<ManagedBrowserReceipt>(`select r.id,r.action,r.outcome,r.recorded_at::text as at
    from mind_managed_browser_receipt r join mind_managed_browser s on s.id=r.session_id
    where s.user_id=$1 and s.id=$2 order by r.recorded_at desc,r.id desc limit 12`, [owner, session]);
}

export async function runManagedBrowserAction(sql: Sql, owner: string, id: string | null, action: ManagedAction, send: BrowserTransport) {
  if (!sql.transaction) return { status: 503, error: "Managed browser storage is unavailable." };
  const operation = randomUUID();
  const readOnly = action.kind === "status" || action.kind === "stop";
  const claimed = await sql.transaction(async tx => {
    if (!readOnly) {
      await tx.query("insert into mind_control(user_id,halted) values($1,false) on conflict do nothing", [owner]);
      const [control] = await tx.query<{ halted: boolean }>("select halted from mind_control where user_id=$1 for update", [owner]);
      if (control?.halted !== false) return { status: 409, error: "Clear the emergency stop before controlling the browser." };
    }
    const session = action.kind === "start" ? randomUUID() : id;
    if (!session) return { status: 400, error: "Choose a managed browser session." };
    const args = [session, owner, operation, action.kind];
    const [row] = action.kind === "start"
      ? await tx.query<Row>(`insert into mind_managed_browser(id,user_id,origin,mode,operation,pending) values($1,$2,$5,'unconfirmed',$4,$3)
          on conflict do nothing returning id,origin,mode,operation,updated_at::text`, [...args, action.origin])
      : await tx.query<Row>(`update mind_managed_browser set pending=$3,operation=$4,updated_at=now()
          where id=$1 and user_id=$2 and ended_at is null
            and (pending is null or ($4 in ('status','stop') and updated_at < now()-interval '25 seconds'))
            and ($4 in ('status','stop') or mode <> 'unconfirmed')
          returning id,origin,mode,operation,updated_at::text`, args);
    if (!row) return { status: 409, error: "This session is unavailable or busy. Refresh its status before retrying." };
    await tx.query("insert into mind_managed_browser_receipt(id,session_id,action,outcome) values($1,$2,$3,'attempted')", [operation, row.id, action.kind]);
    return { status: 200, row };
  });
  if (!claimed.row) return claimed;
  const { row } = claimed;
  let observed: Outcome;
  try { observed = await send(row.id, operation, action); } catch { observed = {}; }
  const outcome = observed.reply ? "confirmed" : observed.rejected ? "rejected" : "unconfirmed";
  const mode = observed.reply?.mode ?? (observed.rejected ? action.kind === "start" ? "stopped" : row.mode : "unconfirmed");
  const [updated] = await sql.transaction(async tx => {
    await tx.query("update mind_managed_browser_receipt set outcome=$2 where id=$1", [operation, outcome]);
    return tx.query<Row>(`update mind_managed_browser set mode=$4,pending=null,updated_at=now(),
      ended_at=case when $4='stopped' then now() else ended_at end
      where id=$1 and user_id=$2 and pending=$3 returning id,origin,mode,operation,updated_at::text`, [row.id, owner, operation, mode]);
  });
  if (!updated) return { status: 409, error: "A newer browser check superseded this action." };
  return { status: observed.reply ? 200 : observed.rejected ? 409 : 503,
    session: publicSession(updated), outcome, frame: observed.reply?.frame,
    error: observed.reply ? undefined : observed.rejected ? "The browser worker declined the action. Check its current status." : "The browser worker did not confirm the outcome. Check status before sending another action.",
  };
}
