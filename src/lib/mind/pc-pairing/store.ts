import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, linkSync, renameSync, statSync, unlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { localDataPath } from "../../local-data.ts";

export type PairedAgent = {
  id: string;
  ownerId: string;
  label: string;
  tokenHash: string;
  registeredAt: string;
  lastSeenAt: string;
  fileProtocol?: 2;
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
  receiptId?: string;
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
      if (agent.ownerId === ownerId) {
        agent.lastSeenAt = statSync(join(agentsDir(), name)).mtime.toISOString();
        if (existsSync(join(agentsDir(), name + ".file-v2"))) agent.fileProtocol = 2;
        out.push(agent);
      }
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
  if (!path) return;
  try {
    const now = new Date();
    // A heartbeat must never recreate a concurrently revoked credential.
    utimesSync(path, now, now);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function recordFileProtocol(agentId: string, supportsPreconditions: boolean) {
  const path = agentPath(agentId);
  if (!path) return;
  const marker = path + ".file-v2";
  if (supportsPreconditions) {
    if (!existsSync(marker)) writeFileSync(marker, "");
  } else if (existsSync(marker)) {
    try { unlinkSync(marker); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
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
  jobKey?: string;
  ownerId: string;
  agentId: string;
  kind?: PcJob["kind"];
  payload?: Record<string, unknown>;
  command: string;
  confirm: boolean;
}): PcJob {
  ensure();
  if (input.jobKey !== undefined && !/^[a-f0-9]{32}$/.test(input.jobKey)) throw new Error("Invalid job ID.");
  const now = new Date().toISOString();
  const job: PcJob = {
    id: input.jobKey ?? randomBytes(12).toString("hex"),
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
  const path = join(jobsDir(), `${job.id}.json`);
  const staging = path + "." + randomBytes(8).toString("hex") + ".tmp";
  writeFileSync(staging, JSON.stringify(job), { mode: 0o600, flag: "wx" });
  try {
    linkSync(staging, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const prior = readJob(job.id);
    if (!prior || prior.ownerId !== job.ownerId || prior.agentId !== job.agentId || prior.kind !== job.kind ||
        prior.command !== job.command || prior.confirm !== job.confirm || JSON.stringify(prior.payload) !== JSON.stringify(job.payload)) {
      throw new Error("Job ID already in use.");
    }
    return prior;
  } finally {
    unlinkSync(staging);
  }
  return job;
}

type Transition = Pick<PcJob, "status"> & Partial<Pick<PcJob, "receiptId" | "error" | "output">>;

function snapshot(jobId: string) {
  const path = jobPath(jobId);
  if (!path) return null;
  let job: PcJob;
  try {
    job = JSON.parse(readFileSync(path, "utf8")) as PcJob;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  // Each transition publishes a complete delta at the next sequence number.
  // Older jobs start at sequence zero and are readable without a migration.
  let sequence = 0;
  while (existsSync(`${path}.${sequence + 1}`)) {
    Object.assign(job, JSON.parse(readFileSync(`${path}.${++sequence}`, "utf8")));
  }
  return { job, path, sequence };
}

export function readJob(jobId: string): PcJob | null {
  return snapshot(jobId)?.job ?? null;
}

function changeJob(jobId: string, decide: (job: PcJob) => Transition | "unchanged" | null): PcJob | null {
  for (;;) {
    const current = snapshot(jobId);
    if (!current) return null;
    const delta = decide(current.job);
    if (!delta) return null;
    if (delta === "unchanged") return current.job;
    const update = { ...delta, updatedAt: new Date().toISOString() };
    const temp = `${current.path}.${randomBytes(12).toString("hex")}.tmp`;
    writeFileSync(temp, JSON.stringify(update), { mode: 0o600, flag: "wx" });
    try {
      linkSync(temp, `${current.path}.${current.sequence + 1}`);
      return { ...current.job, ...update };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A concurrent cancel, claim or result won. Reevaluate the transition.
    } finally {
      unlinkSync(temp);
    }
  }
}

export function offerNextJob(agentId: string): PcJob | null {
  ensure();
  return readdirSync(jobsDir())
    .filter((n) => n.endsWith(".json") && !existsSync(join(jobsDir(), n + ".1")))
    .map((n) => readJob(n.replace(/\.json$/, "")))
    .filter((j): j is PcJob => Boolean(j && j.agentId === agentId && j.status === "queued"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
}

export function acceptJob(agentId: string, jobId: string, receiptId?: string): PcJob | null {
  const job = changeJob(jobId, (current) => {
    if (current.agentId !== agentId) return null;
    if (receiptId && current.receiptId === receiptId) return "unchanged";
    if (current.status !== "queued") return null;
    return { status: "running", receiptId };
  });
  if (job) touchAgent(agentId);
  return job;
}

export function claimNextJob(agentId: string): PcJob | null {
  const offered = offerNextJob(agentId);
  if (!offered) return null;
  const payload = offered.payload;
  if (offered.kind === "file-op" && (payload?.expectedContent !== undefined || payload?.expectedMissing === true || payload?.expectedRevision !== undefined)) {
    changeJob(offered.id, (job) => job.status === "queued" ? { status: "error", error: "Update the paired Companion before making reviewed changes. Nothing was executed." } : null);
    return null;
  }
  return acceptJob(agentId, offered.id);
}

export function requestJobCancel(ownerId: string, jobId: string): PcJob | null {
  return changeJob(jobId, (job) => {
    if (job.ownerId !== ownerId) return null;
    if (job.status === "cancel_requested") return "unchanged";
    if (job.status !== "queued" && job.status !== "running") return null;
    return { status: job.status === "queued" ? "cancelled" : "cancel_requested", error: "Cancellation requested by the owner." };
  });
}

/** Requests cancellation for this owner's known jobs; running jobs remain unconfirmed. */
export function cancelOwnerJobs(ownerId: string): { cancelled: number; pending: number; unknown: number } {
  ensure();
  const result = { cancelled: 0, pending: 0, unknown: 0 };
  for (const name of readdirSync(jobsDir()).filter((item) => item.endsWith(".json"))) {
    const job = readJob(name.slice(0, -5));
    if (!job || job.ownerId !== ownerId || !["queued", "running", "cancel_requested"].includes(job.status)) continue;
    const next = requestJobCancel(ownerId, job.id);
    if (!next) result.unknown += 1;
    else if (next.status === "cancelled") result.cancelled += 1;
    else result.pending += 1;
  }
  return result;
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
  const job = changeJob(input.jobId, (current) => {
    if (current.agentId !== input.agentId || current.status === "queued") return null;
    if (current.status === "cancel_requested") return { status: "cancelled", error: "Cancelled by the owner." };
    if (current.status !== "running") return "unchanged";
    const output = input.output ?? "";
    if (current.kind === "file-op" && input.ok) {
      // Two 1M-code-unit file versions can each expand sixfold when JSON escaped.
      if (output.length <= 12_100_000) {
        try {
          const result = JSON.parse(output);
          if (result && typeof result === "object" && !Array.isArray(result)) return { status: "done", output, error: "" };
        } catch { /* report a readable terminal outcome below */ }
      }
      return { status: "error", error: "PC reported completion but its file result is unreadable. Check the workspace before retrying." };
    }
    return { status: input.ok ? "done" : "error", output: output.slice(0, 8000), error: (input.error ?? "").slice(0, 2000) };
  });
  if (job) touchAgent(input.agentId);
  return job;
}

export function markJobTimeout(jobId: string) {
  changeJob(jobId, (job) => job.status === "queued" || job.status === "running"
    ? { status: "timeout", error: "Timed out waiting for the paired PC agent. Check the workspace before retrying." }
    : null);
}

export function onlineAgents(ownerId: string, onlineMs = 60_000, now = Date.now()): PairedAgent[] {
  return listAgents(ownerId).filter((agent) => {
    const seen = Date.parse(agent.lastSeenAt);
    return Number.isFinite(seen) && now - seen <= onlineMs;
  });
}
