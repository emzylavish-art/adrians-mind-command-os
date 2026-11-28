import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { readHaltState } from "./halt.server.ts";
import {
  browserInput, managedBrowserId, managedBrowserLifetimeMs, managedBrowserOrigins, managedBrowserUrl,
  type BrowserInput, type BrowserPhase, type BrowserReceipt, type ManagedBrowserSession, type ManagedFrame,
} from "./managed-browser.ts";

type WorkerResult = { phase: "managed" | "manual" | "closed"; frame?: ManagedFrame; refusedLink?: boolean };
type Worker = (id: string, input: BrowserInput, target?: string, expires?: number) => Promise<WorkerResult>;
type Options = { origins: Set<string>; worker?: Worker; localHalt?: typeof readHaltState };
type Row = {
  session_id: string; origin: string; phase: BrowserPhase; revision: number; pending: string | null;
  pending_at: string | null; expires_at: string; receipts: BrowserReceipt[];
};
type Result = { status: number; body: object };
const result = (status: number, body: object): Result => ({ status, body });
const error = (status: number, message: string) => result(status, { error: message });
const apiSession = (row: Row): ManagedBrowserSession => ({
  id: row.session_id, origin: row.origin, phase: row.phase, revision: row.revision, pending: row.pending,
  expires: new Date(row.expires_at).toISOString(), receipts: row.receipts,
});
const columns = "session_id,origin,phase,revision,pending,pending_at::text,expires_at::text,receipts";
const leaseMs = 16_000;

function workerId(owner: string, id: string) {
  const hash = createHash("sha256").update(JSON.stringify([owner, id.toLowerCase()])).digest("hex");
  return [hash.slice(0, 8), hash.slice(8, 12), "4" + hash.slice(13, 16), "8" + hash.slice(17, 20), hash.slice(20, 32)].join("-");
}

export function managedBrowserConfig(env = process.env): Options {
  const origins = managedBrowserOrigins(env.ADRIAN_MANAGED_BROWSER_ORIGINS);
  const token = env.ADRIAN_MANAGED_BROWSER_TOKEN?.trim();
  try {
    const endpoint = new URL(env.ADRIAN_MANAGED_BROWSER_URL ?? "");
    if (!token || token.length < 32 || !origins.size || endpoint.username || endpoint.password || endpoint.hash || endpoint.search ||
        (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1"))) return { origins };
    return { origins, worker: async (id, input, target, expires) => {
      const response = await fetch(new URL("/session", endpoint), {
        method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ id, ...input, target, expires }), cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(11_000),
      });
      if (!response.ok || !response.body) throw new Error("Worker action unconfirmed");
      const reader = response.body.getReader();
      let size = 0;
      const parts: Uint8Array[] = [];
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 900_000) { await reader.cancel(); throw new Error("Worker response too large"); }
        parts.push(part.value);
      }
      return JSON.parse(Buffer.concat(parts).toString("utf8"));
    } };
  } catch { return { origins }; }
}

async function selectSession(sql: Sql, owner: string, id: string, lock = false) {
  const [row] = await sql.query<Row>(`select ${columns} from mind_managed_browser_control where user_id=$1 and session_id=$2${lock ? " for update" : ""}`, [owner, id]);
  return row;
}

function frameFor(origin: string, frame: ManagedFrame | undefined) {
  if (!frame) return;
  const page = typeof frame.path === "string" && frame.path.startsWith("/") ? managedBrowserUrl(origin + frame.path) : null;
  if (!page || page.origin !== origin || typeof frame.image !== "string" || frame.image.length > 554_000 || !/^\/9j\/[A-Za-z0-9+/]+=*$/.test(frame.image)) {
    throw new Error("Invalid managed browser frame");
  }
  const links = Array.isArray(frame.links) ? frame.links.slice(0, 20).filter(link =>
    link && typeof link.label === "string" && link.label.length > 0 && link.label.length <= 120 &&
    browserInput({ action: "follow", x: link.x, y: link.y }),
  ).map(({ x, y, label }) => ({ x, y, label })) : undefined;
  return { image: frame.image, path: page.pathname, links };
}

export async function managedBrowserRequest(sql: Sql, owner: string, body: Record<string, unknown>, options: Options = managedBrowserConfig()): Promise<Result> {
  if (body.action === "list") {
    if (!options.worker) return result(200, { configured: false, sessions: [] });
    const rows = await sql.query<Row>(`select ${columns} from mind_managed_browser_control where user_id=$1 order by expires_at desc limit 8`, [owner]);
    return result(200, { configured: Boolean(options.worker), origins: [...options.origins], sessions: rows.map(apiSession) });
  }
  const input = browserInput(body);
  if (!input || typeof body.id !== "string" || !managedBrowserId.test(body.id)) return error(400, "Choose a valid browser action.");
  if (!options.worker || !sql.transaction) return error(503, "The managed browser worker is unavailable.");
  const id = body.id;
  const worker = options.worker;
  const target = input.action === "start" ? managedBrowserUrl(body.target) : null;
  if (input.action === "start" && (body.approved !== true || !target || !options.origins.has(target.origin))) return error(400, "Review and approve a supported HTTPS website.");
  const canRunWhileHalted = input.action === "stop" || input.action === "recover";
  if (!canRunWhileHalted && (await (options.localHalt ?? readHaltState)(owner)) !== "off") return error(409, "Emergency control must be clear before browsing.");
  const claim = await sql.transaction(async tx => {
    // The account control row gates first use and serializes all browser claims.
    await tx.query("insert into mind_control(user_id,halted) values($1,false) on conflict do nothing", [owner]);
    const [control] = await tx.query<{ halted: boolean }>("select halted from mind_control where user_id=$1 for update", [owner]);
    if (!canRunWhileHalted && control?.halted !== false) return { failure: error(409, "Emergency control must be clear before browsing.") } as const;
    let row = await selectSession(tx, owner, id, true);
    if (row && input.action === "start") return { failure: result(200, { session: apiSession(row) }) } as const;
    if (input.action === "start" && target) {
      await tx.query("insert into mind_snapshot(user_id,payload) values($1,'{}'::jsonb) on conflict do nothing", [owner]);
      const active = await tx.query("select session_id from mind_managed_browser_control where user_id=$1 and phase<>'closed' and expires_at>now() limit 1", [owner]);
      if (active.length) return { failure: error(409, "Close or recover your existing browser session first.") } as const;
      await tx.query("delete from mind_managed_browser_control where user_id=$1 and session_id in (select session_id from mind_managed_browser_control where user_id=$1 order by expires_at desc offset 15)", [owner]);
      [row] = await tx.query<Row>(`insert into mind_managed_browser_control(user_id,session_id,origin,phase,expires_at)
        values($1,$2,$3,'starting',$4) returning ${columns}`, [owner, id, target.origin, new Date(Date.now() + managedBrowserLifetimeMs).toISOString()]);
    } else if (!row) {
      return { failure: error(404, "Browser session not found.") } as const;
    }
    if (input.action !== "start" && body.revision !== row.revision) return { failure: error(409, "Browser state changed. Reload the saved session.") } as const;
    if (row.phase === "closed") return { failure: result(200, { session: apiSession(row) }) } as const;
    if (!canRunWhileHalted && (!options.origins.has(row.origin) || Date.parse(row.expires_at) <= Date.now())) {
      return { failure: error(409, "This session expired or its destination approval was removed. Close it or check its state.") } as const;
    }
    if (row.pending && input.action !== "stop") {
      if (Date.now() - Date.parse(row.pending_at ?? "") < leaseMs) return { failure: error(409, "The previous browser action is still settling.") } as const;
      if (!canRunWhileHalted) return { failure: error(409, "Check the outcome of the prior browser action first.") } as const;
    }
    const required = input.action === "takeover" ? "managed" : ["handback","follow","scroll"].includes(input.action) ? "manual" : undefined;
    if (required && row.phase !== required) return { failure: error(409, "Current browser control does not permit this action.") } as const;
    if (input.action === "frame" && !["managed", "manual"].includes(row.phase)) return { failure: error(409, "Check the browser state first.") } as const;
    const claimToken = randomUUID();
    if (input.action === "frame") return { row, claimToken: null, halted: control?.halted !== false } as const;
    await tx.query("update mind_managed_browser_control set pending=$3,pending_at=now(),revision=revision+1 where user_id=$1 and session_id=$2", [owner, id, claimToken]);
    return { row, claimToken, halted: control?.halted !== false } as const;
  });
  if (claim.failure) return claim.failure;
  const { row, claimToken } = claim;
  let phase: BrowserPhase = "uncertain";
  let frame: ManagedFrame | undefined;
  let refusedLink = false;
  try {
    // A halt committed while the claim was being persisted prevents dispatch.
    const halted = claim.halted || await (options.localHalt ?? readHaltState)(owner) !== "off";
    const checked = halted && input.action === "recover" ? { action: "stop" } as const : input;
    if (halted && checked.action !== "stop") throw new Error("Emergency control stopped the action");
    const response = await worker(workerId(owner, id), checked, target?.href, Date.parse(row.expires_at));
    if (!["managed", "manual", "closed"].includes(response.phase) || (checked.action === "stop" && response.phase !== "closed")) throw new Error("Worker state unavailable");
    phase = response.phase;
    refusedLink = checked.action === "follow" && response.refusedLink === true;
    frame = phase !== "closed" && options.origins.has(row.origin) && await (options.localHalt ?? readHaltState)(owner) === "off"
      ? frameFor(row.origin, response.frame) : undefined;
  } catch { phase = "uncertain"; }
  if (!claimToken) {
    const fresh = await selectSession(sql, owner, id);
    if (!fresh || fresh.revision !== row.revision || fresh.pending || phase !== fresh.phase || !frame) {
      return error(409, "The saved browser state needs to be checked.");
    }
    return result(200, { session: apiSession(fresh), frame });
  }
  const receipts = [...row.receipts, { action: input.action, phase, at: new Date().toISOString() }].slice(-16);
  const [saved] = await sql.query<Row>(`update mind_managed_browser_control set phase=$4,pending=null,pending_at=null,receipts=$5::jsonb
    where user_id=$1 and session_id=$2 and pending=$3 returning ${columns}`, [owner, id, claimToken, phase, JSON.stringify(receipts)]);
  return saved ? result(200, { session: apiSession(saved), frame, refusedLink }) : error(409, "Another action changed the browser. Reload the saved session.");
}

export async function stopOwnerManagedBrowser(sql: Sql, owner: string, options = managedBrowserConfig()): Promise<void> {
  if (!options.worker) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const [active] = await sql.query<Row>(`select ${columns} from mind_managed_browser_control
      where user_id=$1 and phase<>'closed' and expires_at>now() order by expires_at desc limit 1`, [owner]);
    if (!active) return;
    const reply = await managedBrowserRequest(sql, owner, { action: "stop", id: active.session_id, revision: active.revision }, options);
    if (reply.status !== 409) return;
  }
}
