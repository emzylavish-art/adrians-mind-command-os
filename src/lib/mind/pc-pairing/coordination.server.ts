/** Hosted coordination is shared Postgres; installed/local runtimes retain their file store. */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Sql } from "../../db.ts";
import { resolveDatabaseUrl } from "../../env.server.ts";
import * as local from "./store.ts";
import type { PairedAgent, PcJob, PcJobEvent, JobTransition, JobCompletionInput } from "./store.ts";
export type { PairedAgent, PcJob, PcJobEvent } from "./store.ts";
export { deviceReadiness, parseDeviceCapabilities } from "./store.ts";
let testSql: Sql | undefined;
export function setCoordinationSqlForTests(sql?: Sql) { testSql = sql; }
function shared() { return Boolean(testSql || resolveDatabaseUrl() || process.env.VERCEL || process.env.GROK_PROJECT_ID); }
async function database(): Promise<Sql> {
  if (testSql) return testSql;
  if (!resolveDatabaseUrl()) throw new Error("Shared device coordination is unavailable. No local substitute was used.");
  return (await import("../../db.ts")).getSql();
}
const safeId = (id: string) => /^[a-f0-9]{16,64}$/.test(id);
async function mutation(jobId: string, decide: (job: PcJob) => JobTransition | "unchanged" | null, currentAgent?: string): Promise<PcJob | null> {
  if (!safeId(jobId)) return null;
  const sql = await database();
  if (!sql.transaction) throw new Error("Atomic device coordination is unavailable.");
  return sql.transaction(async (tx) => {
    const [row] = currentAgent ? await tx.query<{ record: PcJob }>("select j.record from mind_pc_jobs j join mind_pc_agents a on a.agent_id=j.agent_id and a.owner_id=j.owner_id where j.job_id=$1 and a.agent_id=$2 for update of j,a", [jobId, currentAgent]) : await tx.query<{ record: PcJob }>("select record from mind_pc_jobs where job_id=$1 for update", [jobId]);
    if (!row) return null;
    const delta = decide(row.record);
    if (!delta) return null;
    if (delta === "unchanged") return row.record;
    const record = { ...row.record, ...delta, updatedAt: new Date().toISOString() };
    await tx.query("update mind_pc_jobs set record=$2::jsonb,status=$3,updated_at=now() where job_id=$1", [jobId, JSON.stringify(record), record.status]);
    return record;
  });
}
export async function registerAgent(input: Parameters<typeof local.registerAgent>[0]) {
  if (!shared()) return local.registerAgent(input);
  if (input.expectedPairingSecret && !timingSafeEqual(Buffer.from(local.hashToken(input.expectedPairingSecret)), Buffer.from(local.hashToken(input.pairingSecret ?? "")))) return { ok: false as const, error: "Pairing secret is invalid." };
  if (!input.ownerId) return { ok: false as const, error: "Sign in is required." };
  const token = randomBytes(32).toString("hex");
  const now = new Date().toISOString();
  const agent: PairedAgent = { id: randomBytes(12).toString("hex"), ownerId: input.ownerId, tokenHash: local.hashToken(token), label: (input.label || "Paired computer").slice(0, 100), registeredAt: now, lastSeenAt: now };
  const sql = await database();
  await sql.query("insert into mind_pc_agents(agent_id,owner_id,token_hash,record) values($1,$2,$3,$4::jsonb)", [agent.id, agent.ownerId, agent.tokenHash, JSON.stringify(agent)]);
  return { ok: true as const, agentId: agent.id, agentToken: token, label: agent.label };
}
export async function listAgents(ownerId: string): Promise<PairedAgent[]> {
  if (!shared()) return local.listAgents(ownerId);
  const sql = await database();
  const rows = await sql.query<{ record: PairedAgent; last_seen_at: Date | string }>("select record,last_seen_at from mind_pc_agents where owner_id=$1 order by agent_id limit 100", [ownerId]);
  return rows.map((row) => ({ ...row.record, lastSeenAt: new Date(row.last_seen_at).toISOString() }));
}
export async function onlineAgents(ownerId: string, onlineMs = 60_000, now = Date.now()): Promise<PairedAgent[]> {
  return (await listAgents(ownerId)).filter((agent) => Number.isFinite(Date.parse(agent.lastSeenAt)) && now - Date.parse(agent.lastSeenAt) <= onlineMs);
}
export async function findAgentByToken(token: string): Promise<PairedAgent | null> {
  if (!shared()) return local.findAgentByToken(token);
  if (typeof token !== "string" || token.length > 1024) return null;
  const [row] = await (await database()).query<{ record: PairedAgent }>("select record from mind_pc_agents where token_hash=$1", [local.hashToken(token)]);
  return row?.record ?? null;
}
export async function touchAgent(id: string) {
  if (!shared()) return local.touchAgent(id);
  if (safeId(id)) await (await database()).query("update mind_pc_agents set last_seen_at=now() where agent_id=$1", [id]);
}
export async function recordFileProtocol(id: string, modern: boolean) {
  if (!shared()) return local.recordFileProtocol(id, modern);
  if (!safeId(id)) return;
  await (await database()).query("update mind_pc_agents set record=case when $2 then jsonb_set(record,'{fileProtocol}','2'::jsonb) else record-'fileProtocol' end where agent_id=$1", [id, modern]);
}
export async function recordCapabilities(id: string, value: unknown) {
  if (!shared()) return local.recordCapabilities(id, value);
  const manifest = local.parseDeviceCapabilities(value);
  if (!manifest || !safeId(id)) return false;
  const rows = await (await database()).query("update mind_pc_agents set record=jsonb_set(record,'{capabilities}',$2::jsonb) where agent_id=$1 returning agent_id", [id, JSON.stringify(manifest)]);
  return rows.length === 1;
}
export async function unregisterAgent(ownerId: string, id: string): Promise<boolean> {
  if (!shared()) return local.unregisterAgent(ownerId, id);
  if (!safeId(id)) return false;
  return (await (await database()).query("delete from mind_pc_agents where owner_id=$1 and agent_id=$2 returning agent_id", [ownerId, id])).length === 1;
}
export async function enqueueJob(input: Parameters<typeof local.enqueueJob>[0]): Promise<PcJob> {
  if (!shared()) return local.enqueueJob(input);
  if (input.jobKey !== undefined && !/^[a-f0-9]{32}$/.test(input.jobKey)) throw new Error("Invalid job ID.");
  const sql = await database();
  if (!sql.transaction) throw new Error("Atomic device queue unavailable.");
  return sql.transaction(async (tx) => {
    const [agent] = await tx.query<{ owner_id: string }>("select owner_id from mind_pc_agents where agent_id=$1 for update", [input.agentId]);
    if (!agent || agent.owner_id !== input.ownerId) throw new Error("The selected device is not authorized for this owner.");
    const now = new Date().toISOString();
    const job: PcJob = { id: input.jobKey || randomBytes(12).toString("hex"), ownerId: input.ownerId, agentId: input.agentId, kind: input.kind ?? "shell", payload: input.payload, command: input.command.slice(0, 500), confirm: input.confirm === true, status: "queued", createdAt: now, updatedAt: now };
    const inserted = await tx.query("insert into mind_pc_jobs(job_id,owner_id,agent_id,status,record) values($1,$2,$3,'queued',$4::jsonb) on conflict do nothing returning job_id", [job.id, job.ownerId, job.agentId, JSON.stringify(job)]);
    if (inserted.length) return job;
    const [existing] = await tx.query<{ record: PcJob }>("select record from mind_pc_jobs where job_id=$1", [job.id]);
    const prior = existing?.record;
    if (!prior || prior.ownerId !== job.ownerId || prior.agentId !== job.agentId || prior.kind !== job.kind || prior.command !== job.command || prior.confirm !== job.confirm || JSON.stringify(prior.payload) !== JSON.stringify(job.payload)) throw new Error("Job ID already in use.");
    return prior;
  });
}
export async function readJob(id: string): Promise<PcJob | null> {
  if (!shared()) return local.readJob(id);
  if (!safeId(id)) return null;
  return (await (await database()).query<{ record: PcJob }>("select record from mind_pc_jobs where job_id=$1", [id]))[0]?.record ?? null;
}
export async function offerNextJob(agentId: string): Promise<PcJob | null> {
  if (!shared()) return local.offerNextJob(agentId);
  if (!safeId(agentId)) return null;
  return (await (await database()).query<{ record: PcJob }>("select j.record from mind_pc_jobs j join mind_pc_agents a on a.agent_id=j.agent_id and a.owner_id=j.owner_id where j.agent_id=$1 and j.status='queued' order by j.created_at,j.job_id limit 1", [agentId]))[0]?.record ?? null;
}
export async function acceptJob(agentId: string, jobId: string, receiptId?: string): Promise<PcJob | null> {
  if (!shared()) return local.acceptJob(agentId, jobId, receiptId);
  // Revoked credentials cannot accept queued work, even after a stale offer.
  const agent = (await (await database()).query("select agent_id from mind_pc_agents where agent_id=$1", [agentId]))[0];
  if (!agent) return null;
  const job = await mutation(jobId, (current) => {
    if (current.agentId !== agentId) return null;
    if (receiptId && current.receiptId === receiptId) return "unchanged";
    return current.status === "queued" ? { status: "running", receiptId, acceptedAt: new Date().toISOString() } : null;
  }, agentId);
  if (job) await touchAgent(agentId);
  return job;
}
export async function claimNextJob(agentId: string): Promise<PcJob | null> {
  if (!shared()) return local.claimNextJob(agentId);
  const offered = await offerNextJob(agentId);
  if (!offered) return null;
  const payload = offered.payload;
  if (offered.kind === "kimi-acp" && (payload?.expectedBranch || payload?.artifactName)) return null;
  if (offered.kind === "file-op" && (payload?.expectedContent !== undefined || payload?.expectedMissing === true || payload?.expectedRevision !== undefined)) {
    await mutation(offered.id, (job) => job.status === "queued" ? { status: "error", error: "Update the paired Companion before making reviewed changes. Nothing was executed." } : null);
    return null;
  }
  return acceptJob(agentId, offered.id);
}
export async function requestJobCancel(ownerId: string, jobId: string): Promise<PcJob | null> {
  if (!shared()) return local.requestJobCancel(ownerId, jobId);
  return mutation(jobId, (job) => {
    if (job.ownerId !== ownerId) return null;
    if (job.status === "cancel_requested") return "unchanged";
    if (job.status !== "queued" && job.status !== "running") return null;
    return { status: job.status === "queued" ? "cancelled" : "cancel_requested", cancellationRequestedAt: new Date().toISOString(), error: "Cancellation requested by the owner." };
  });
}
export async function completeJob(input: JobCompletionInput): Promise<PcJob | null> {
  if (!shared()) return local.completeJob(input);
  const job = await mutation(input.jobId, (current) => local.jobCompletionTransition(current, input));
  if (job) await touchAgent(input.agentId);
  return job;
}
export async function markJobTimeout(jobId: string) {
  if (!shared()) return local.markJobTimeout(jobId);
  return mutation(jobId, (job) => job.status === "queued" || job.status === "running" ? { status: "timeout", communicationTimedOutAt: new Date().toISOString(), error: "Timed out waiting for the paired PC agent. Outcome is uncertain; check before retrying." } : null);
}
export async function appendJobEvent(input: Parameters<typeof local.appendJobEvent>[0]): Promise<PcJobEvent | null> {
  if (!shared()) return local.appendJobEvent(input);
  const job = await readJob(input.jobId);
  if (!job || job.agentId !== input.agentId) return null;
  const event: PcJobEvent = { id: randomBytes(12).toString("hex"), jobId: job.id, ownerId: job.ownerId, type: input.type.slice(0, 80), payload: input.payload ?? {}, createdAt: new Date().toISOString() };
  await (await database()).query("insert into mind_pc_events(event_id,owner_id,job_id,record,created_at) values($1,$2,$3,$4::jsonb,$5::timestamptz)", [event.id, event.ownerId, event.jobId, JSON.stringify(event), event.createdAt]);
  await touchAgent(input.agentId);
  return event;
}
export async function listJobEvents(ownerId: string, jobId: string, limit = 200, after?: string): Promise<PcJobEvent[]> {
  if (!shared()) return local.listJobEvents(ownerId, jobId, limit).filter((event) => !after || event.createdAt > after);
  const bounded = Math.max(1, Math.min(Math.floor(limit), 500));
  const [afterTime, afterId = ""] = (after ?? "").split("|");
  if (after && !Number.isFinite(Date.parse(afterTime))) throw new Error("Invalid event cursor.");
  const rows = await (await database()).query<{ record: PcJobEvent }>(after
    ? "select record from mind_pc_events where owner_id=$1 and job_id=$2 and (created_at,event_id) > ($4::timestamptz,$5) order by created_at,event_id limit $3"
    : "select record from mind_pc_events where owner_id=$1 and job_id=$2 order by created_at desc,event_id desc limit $3", after ? [ownerId, jobId, bounded, afterTime, afterId] : [ownerId, jobId, bounded]);
  return after ? rows.map((row) => row.record) : rows.map((row) => row.record).reverse();
}
export async function pruneDeviceEvents(ownerId: string, before: string, limit = 500) {
  if (!shared()) return 0;
  const result = await (await database()).query("delete from mind_pc_events where event_id in(select event_id from mind_pc_events where owner_id=$1 and created_at < $2::timestamptz order by created_at limit $3) returning event_id", [ownerId, before, Math.max(1, Math.min(limit, 500))]);
  return result.length;
}
