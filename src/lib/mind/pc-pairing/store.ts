import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { localDataPath } from "../../local-data.ts";

export type PairedAgent = {
  id: string;
  ownerId: string;
  label: string;
  tokenHash: string;
  registeredAt: string;
  lastSeenAt: string;
};

export type PcJob = {
  id: string;
  ownerId: string;
  agentId: string;
  kind: "shell" | "kimi-acp" | "file-op";
  payload?: Record<string, unknown>;
  command: string;
  confirm: boolean;
  status: "queued" | "running" | "cancel_requested" | "cancelled" | "done" | "error" | "timeout";
  createdAt: string;
  updatedAt: string;
  output?: string;
  error?: string;
};

export type PcJobEvent = {
  id: string;
  jobId: string;
  ownerId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

let directory = localDataPath("mind-pc-pairing");

export function setPcPairingDirectory(next: string) {
  directory = next;
}

function agentsDir() {
  return join(directory, "agents");
}
function jobsDir() {
  return join(directory, "jobs");
}
function eventsDir() {
  return join(directory, "events");
}

const PAIRING_ID_PATTERN = /^[a-f0-9]{16,64}$/;

function isSafePairingId(id: string): boolean {
  return typeof id === "string" && PAIRING_ID_PATTERN.test(id) && !id.includes("\0");
}

function agentPath(agentId: string): string | null {
  if (!isSafePairingId(agentId)) return null;
  return join(agentsDir(), `${agentId}.json`);
}

function jobPath(jobId: string): string | null {
  if (!isSafePairingId(jobId)) return null;
  return join(jobsDir(), `${jobId}.json`);
}

function eventPath(eventId: string): string | null {
  if (!isSafePairingId(eventId)) return null;
  return join(eventsDir(), `${eventId}.json`);
}

function ensure() {
  mkdirSync(agentsDir(), { recursive: true });
  mkdirSync(jobsDir(), { recursive: true });
  mkdirSync(eventsDir(), { recursive: true });
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function registerAgent(input: {
  ownerId: string;
  label?: string;
  pairingSecret?: string;
  expectedPairingSecret?: string;
}): { ok: true; agentId: string; agentToken: string; label: string } | { ok: false; error: string } {
  ensure();
  const expected = input.expectedPairingSecret?.trim();
  if (expected) {
    const provided = (input.pairingSecret || "").trim();
    if (!provided || provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return { ok: false, error: "Invalid pairing secret. Nothing was registered." };
    }
  }
  const agentId = randomBytes(12).toString("hex");
  const agentToken = randomBytes(24).toString("base64url");
  const now = new Date().toISOString();
  const agent: PairedAgent = {
    id: agentId,
    ownerId: input.ownerId,
    label: (input.label || "Paired PC").slice(0, 80),
    tokenHash: hashToken(agentToken),
    registeredAt: now,
    lastSeenAt: now,
  };
  writeFileSync(join(agentsDir(), `${agentId}.json`), JSON.stringify(agent));
  return { ok: true, agentId, agentToken, label: agent.label };
}

export function listAgents(ownerId: string): PairedAgent[] {
  ensure();
  const out: PairedAgent[] = [];
  for (const name of readdirSync(agentsDir())) {
    if (!name.endsWith(".json")) continue;
    try {
      const agent = JSON.parse(readFileSync(join(agentsDir(), name), "utf8")) as PairedAgent;
      if (agent.ownerId === ownerId) out.push(agent);
    } catch {
      /* skip */
    }
  }
  return out;
}

export function findAgentByToken(token: string): PairedAgent | null {
  ensure();
  const want = hashToken(token);
  for (const name of readdirSync(agentsDir())) {
    if (!name.endsWith(".json")) continue;
    try {
      const agent = JSON.parse(readFileSync(join(agentsDir(), name), "utf8")) as PairedAgent;
      if (safeEqualHex(agent.tokenHash, want)) return agent;
    } catch {
      /* skip */
    }
  }
  return null;
}

export function touchAgent(agentId: string) {
  const path = agentPath(agentId);
  if (!path || !existsSync(path)) return;
  try {
    const agent = JSON.parse(readFileSync(path, "utf8")) as PairedAgent;
    agent.lastSeenAt = new Date().toISOString();
    writeFileSync(path, JSON.stringify(agent));
  } catch {
    /* ignore */
  }
}

export function unregisterAgent(ownerId: string, agentId: string): boolean {
  const path = agentPath(agentId);
  if (!path || !existsSync(path)) return false;
  try {
    const agent = JSON.parse(readFileSync(path, "utf8")) as PairedAgent;
    if (agent.ownerId !== ownerId) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function enqueueJob(input: {
  ownerId: string;
  agentId: string;
  kind?: PcJob["kind"];
  payload?: Record<string, unknown>;
  command: string;
  confirm: boolean;
}): PcJob {
  ensure();
  const now = new Date().toISOString();
  const job: PcJob = {
    id: randomBytes(12).toString("hex"),
    ownerId: input.ownerId,
    agentId: input.agentId,
    kind: input.kind ?? "shell",
    payload: input.payload,
    command: input.command.slice(0, 500),
    confirm: input.confirm === true,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  writeFileSync(join(jobsDir(), `${job.id}.json`), JSON.stringify(job));
  return job;
}

export function readJob(jobId: string): PcJob | null {
  const path = jobPath(jobId);
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PcJob;
  } catch {
    return null;
  }
}

function writeJob(job: PcJob) {
  const path = jobPath(job.id);
  if (!path) return;
  job.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(job));
}

export function claimNextJob(agentId: string): PcJob | null {
  ensure();
  const queued = readdirSync(jobsDir())
    .filter((n) => n.endsWith(".json"))
    .map((n) => readJob(n.replace(/\.json$/, "")))
    .filter((j): j is PcJob => Boolean(j && j.agentId === agentId && j.status === "queued"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const job = queued[0];
  if (!job) return null;
  job.status = "running";
  writeJob(job);
  touchAgent(agentId);
  return job;
}

export function requestJobCancel(ownerId: string, jobId: string): PcJob | null {
  const job = readJob(jobId);
  if (!job || job.ownerId !== ownerId || ["done", "error", "timeout", "cancelled"].includes(job.status)) return null;
  job.status = job.status === "queued" ? "cancelled" : "cancel_requested";
  job.error = "Cancellation requested by the owner.";
  writeJob(job);
  return job;
}

export function appendJobEvent(input: {
  jobId: string;
  agentId: string;
  type: string;
  payload?: Record<string, unknown>;
}): PcJobEvent | null {
  const job = readJob(input.jobId);
  if (!job || job.agentId !== input.agentId) return null;
  ensure();
  const event: PcJobEvent = {
    id: randomBytes(12).toString("hex"),
    jobId: job.id,
    ownerId: job.ownerId,
    type: input.type.slice(0, 80),
    payload: input.payload ?? {},
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(eventsDir(), `${event.id}.json`), JSON.stringify(event));
  touchAgent(input.agentId);
  return event;
}

export function listJobEvents(ownerId: string, jobId: string, limit = 200): PcJobEvent[] {
  ensure();
  const job = readJob(jobId);
  if (!job || job.ownerId !== ownerId) return [];
  return readdirSync(eventsDir())
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5))
    .map((id) => eventPath(id))
    .filter((path): path is string => Boolean(path))
    .map((path) => {
      try {
        return JSON.parse(readFileSync(path, "utf8")) as PcJobEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is PcJobEvent => Boolean(event && event.jobId === jobId && event.ownerId === ownerId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-Math.max(1, Math.min(limit, 500)));
}

export function completeJob(input: {
  jobId: string;
  agentId: string;
  ok: boolean;
  output?: string;
  error?: string;
}): PcJob | null {
  const job = readJob(input.jobId);
  if (!job || job.agentId !== input.agentId) return null;
  if (job.status === "cancel_requested") {
    job.status = "cancelled";
    job.error = "Cancelled by the owner.";
    writeJob(job);
    touchAgent(input.agentId);
    return job;
  }
  job.status = input.ok ? "done" : "error";
  job.output = (input.output || "").slice(0, 8000);
  job.error = (input.error || "").slice(0, 2000);
  writeJob(job);
  touchAgent(input.agentId);
  return job;
}

export function markJobTimeout(jobId: string) {
  const job = readJob(jobId);
  if (!job || ["done", "error", "cancelled"].includes(job.status)) return;
  job.status = "timeout";
  job.error = "Timed out waiting for the paired PC agent.";
  writeJob(job);
}

export function onlineAgents(ownerId: string, onlineMs = 60_000, now = Date.now()): PairedAgent[] {
  return listAgents(ownerId).filter((agent) => {
    const seen = Date.parse(agent.lastSeenAt);
    return Number.isFinite(seen) && now - seen <= onlineMs;
  });
}
