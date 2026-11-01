import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

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
  command: string;
  confirm: boolean;
  status: "queued" | "running" | "done" | "error" | "timeout";
  createdAt: string;
  updatedAt: string;
  output?: string;
  error?: string;
};

let directory = join(process.cwd(), ".data", "mind-pc-pairing");

export function setPcPairingDirectory(next: string) {
  directory = next;
}

function agentsDir() {
  return join(directory, "agents");
}
function jobsDir() {
  return join(directory, "jobs");
}

function ensure() {
  mkdirSync(agentsDir(), { recursive: true });
  mkdirSync(jobsDir(), { recursive: true });
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
  /** Owner-issued pairing secret from env MIND_PC_PAIRING_SECRET; required when set */
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
  const path = join(agentsDir(), `${agentId}.json`);
  if (!existsSync(path)) return;
  try {
    const agent = JSON.parse(readFileSync(path, "utf8")) as PairedAgent;
    agent.lastSeenAt = new Date().toISOString();
    writeFileSync(path, JSON.stringify(agent));
  } catch {
    /* ignore */
  }
}

export function unregisterAgent(ownerId: string, agentId: string): boolean {
  const path = join(agentsDir(), `${agentId}.json`);
  if (!existsSync(path)) return false;
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
  command: string;
  confirm: boolean;
}): PcJob {
  ensure();
  const now = new Date().toISOString();
  const job: PcJob = {
    id: randomBytes(12).toString("hex"),
    ownerId: input.ownerId,
    agentId: input.agentId,
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
  try {
    return JSON.parse(readFileSync(join(jobsDir(), `${jobId}.json`), "utf8")) as PcJob;
  } catch {
    return null;
  }
}

function writeJob(job: PcJob) {
  job.updatedAt = new Date().toISOString();
  writeFileSync(join(jobsDir(), `${job.id}.json`), JSON.stringify(job));
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

export function completeJob(input: {
  jobId: string;
  agentId: string;
  ok: boolean;
  output?: string;
  error?: string;
}): PcJob | null {
  const job = readJob(input.jobId);
  if (!job || job.agentId !== input.agentId) return null;
  job.status = input.ok ? "done" : "error";
  job.output = (input.output || "").slice(0, 8000);
  job.error = (input.error || "").slice(0, 2000);
  writeJob(job);
  touchAgent(input.agentId);
  return job;
}

export function markJobTimeout(jobId: string) {
  const job = readJob(jobId);
  if (!job || job.status === "done" || job.status === "error") return;
  job.status = "timeout";
  job.error = "Timed out waiting for the paired PC agent.";
  writeJob(job);
}

/** Online = seen within the last `onlineMs` (default 60s). */
export function onlineAgents(ownerId: string, onlineMs = 60_000, now = Date.now()): PairedAgent[] {
  return listAgents(ownerId).filter((agent) => {
    const seen = Date.parse(agent.lastSeenAt);
    return Number.isFinite(seen) && now - seen <= onlineMs;
  });
}
