import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Sql } from "../../db.ts";
import { parseDeviceCapabilities, readJob, setPcPairingDirectory, type PairedAgent, type PcJob, type PcJobEvent } from "./store.ts";

export type LegacyDeviceSnapshot = { owner: string; agents: PairedAgent[]; jobs: PcJob[]; events: PcJobEvent[]; fingerprint: string };
/** Explicit offline migration reader. No source file is modified or credential value printed. */
export function readLegacyDeviceSnapshot(directory: string, owner: string): LegacyDeviceSnapshot {
  if (!owner || !path.isAbsolute(directory)) throw new Error("An explicit owner and absolute legacy directory are required.");
  if (!statSync(directory).isDirectory()) throw new Error("The legacy source is not a directory.");
  setPcPairingDirectory(directory);
  const files = (folder: string) => { try { return readdirSync(path.join(directory, folder)).filter((name) => /^[a-f0-9]{16,64}\.json$/.test(name)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } };
  const agents = files("agents").map((name) => {
    const filename = path.join(directory, "agents", name);
    const agent = JSON.parse(readFileSync(filename, "utf8")) as PairedAgent;
    agent.lastSeenAt = statSync(filename).mtime.toISOString();
    try { if (statSync(filename + ".file-v2").isFile()) agent.fileProtocol = 2; } catch { /* No legacy file marker. */ }
    try { agent.capabilities = parseDeviceCapabilities(JSON.parse(readFileSync(filename + ".capabilities", "utf8"))) ?? undefined; } catch { /* Legacy capability unknown. */ }
    return agent;
  }).filter((agent) => agent.ownerId === owner);
  const jobs = files("jobs").map((name) => readJob(name.slice(0, -5))).filter((job): job is PcJob => Boolean(job && job.ownerId === owner));
  const events = files("events").map((name) => JSON.parse(readFileSync(path.join(directory, "events", name), "utf8")) as PcJobEvent).filter((event) => event.ownerId === owner);
  const data = { owner, agents, jobs, events };
  return { ...data, fingerprint: createHash("sha256").update(JSON.stringify(data)).digest("hex") };
}
export function validateLegacyDeviceSnapshot(snapshot: LegacyDeviceSnapshot): void {
  const id = (value: unknown) => typeof value === "string" && /^[a-f0-9]{16,64}$/.test(value);
  if (!snapshot.owner || !/^[a-f0-9]{64}$/.test(snapshot.fingerprint)) throw new Error("Invalid migration identity.");
  if (snapshot.agents.length > 100 || snapshot.jobs.length > 100_000 || snapshot.events.length > 500_000) throw new Error("Legacy device data exceeds the explicit migration batch limit.");
  const all = [...snapshot.agents, ...snapshot.jobs, ...snapshot.events];
  if (all.some((row) => row.ownerId !== snapshot.owner || !id(row.id))) throw new Error("Legacy records must belong to exactly one owner.");
  if (snapshot.agents.some((agent) => !/^[a-f0-9]{64}$/.test(agent.tokenHash) || !Number.isFinite(Date.parse(agent.lastSeenAt)))) throw new Error("Invalid legacy agent credential hash or heartbeat.");
  if (snapshot.jobs.some((job) => !id(job.agentId) || !["queued", "running", "cancel_requested", "cancelled", "done", "error", "timeout"].includes(job.status) || !Number.isFinite(Date.parse(job.createdAt)) || !Number.isFinite(Date.parse(job.updatedAt)))) throw new Error("Invalid legacy job state.");
  if (snapshot.events.some((event) => !snapshot.jobs.some((job) => job.id === event.jobId) || !Number.isFinite(Date.parse(event.createdAt)))) throw new Error("An event has no owned job or valid timestamp.");
}
/** One-time, owner-bound import into an empty destination. Never merges or revives revoked data automatically. */
export async function importLegacyDeviceSnapshot(sql: Sql, snapshot: LegacyDeviceSnapshot): Promise<{ imported: boolean; agents: number; jobs: number; events: number }> {
  validateLegacyDeviceSnapshot(snapshot);
  if (!sql.transaction) throw new Error("Atomic device migration is unavailable.");
  return sql.transaction(async (tx) => {
    const marker = await tx.query("insert into mind_audit(user_id,id,at,action,target,result) values($1,'c1-device-import-v1',now(),'device_migration','account',$2) on conflict(user_id,id) do nothing returning id", [snapshot.owner, snapshot.fingerprint]);
    if (!marker.length) return { imported: false, agents: 0, jobs: 0, events: 0 };
    const [existing] = await tx.query<{ count: number }>("select ((select count(*) from mind_pc_agents where owner_id=$1)+(select count(*) from mind_pc_jobs where owner_id=$1)+(select count(*) from mind_pc_events where owner_id=$1))::integer as count", [snapshot.owner]);
    if (Number(existing.count)) throw new Error("The destination owner already has device records. Reconcile them explicitly; no legacy record was imported.");
    for (const agent of snapshot.agents) await tx.query("insert into mind_pc_agents(agent_id,owner_id,token_hash,record,last_seen_at) values($1,$2,$3,$4::jsonb,$5)", [agent.id, snapshot.owner, agent.tokenHash, JSON.stringify(agent), agent.lastSeenAt]);
    for (const job of snapshot.jobs) await tx.query("insert into mind_pc_jobs(job_id,owner_id,agent_id,status,record,created_at,updated_at) values($1,$2,$3,$4,$5::jsonb,$6,$7)", [job.id, snapshot.owner, job.agentId, job.status, JSON.stringify(job), job.createdAt, job.updatedAt]);
    for (const event of snapshot.events) await tx.query("insert into mind_pc_events(event_id,owner_id,job_id,record,created_at) values($1,$2,$3,$4::jsonb,$5)", [event.id, snapshot.owner, event.jobId, JSON.stringify(event), event.createdAt]);
    return { imported: true, agents: snapshot.agents.length, jobs: snapshot.jobs.length, events: snapshot.events.length };
  });
}
