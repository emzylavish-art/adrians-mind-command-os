import {
  enqueueJob,
  markJobTimeout,
  onlineAgents,
  readJob,
  type PairedAgent,
} from "./store.ts";

export type PairingRunResult = {
  ok: boolean;
  status: "ok" | "error";
  text: string;
  data?: Record<string, unknown>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Enqueue a shell job for an online paired agent and wait for completion.
 * Does not execute commands on this box.
 * `confirm` must mean server-authorized (allowlist or human UI approval) —
 * never pass through a model/client tool-arg confirm.
 */
export async function runOnPairedAgent(input: {
  ownerId: string;
  command: string;
  /** Server-authorized only (allowlist or consumed human approval). */
  confirm: boolean;
  /**
   * Pin dispatch to this paired agent. When set, the job is queued ONLY on
   * this agent (must be owned by ownerId and online); otherwise nothing runs.
   * Never fall back to "first online PC" for a pinned run.
   */
  agentId?: string;
  timeoutMs?: number;
  pollMs?: number;
  now?: number;
}): Promise<PairingRunResult | null> {
  const online = onlineAgents(input.ownerId, 60_000, input.now ?? Date.now());
  if (online.length === 0) return null;
  let agent: PairedAgent | undefined;
  if (input.agentId !== undefined) {
    agent = online.find((candidate) => candidate.id === input.agentId);
    if (!agent) return null;
  } else {
    agent = online[0];
  }
  const job = enqueueJob({
    ownerId: input.ownerId,
    agentId: agent.id,
    command: input.command,
    confirm: input.confirm,
  });
  const timeoutMs = input.timeoutMs ?? 15_000;
  const pollMs = input.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = readJob(job.id);
    if (!current) break;
    if (current.status === "done") {
      return {
        ok: true,
        status: "ok",
        text: (current.output || "(empty output)").slice(0, 8000),
        data: { agentId: agent.id, jobId: job.id, label: agent.label },
      };
    }
    if (current.status === "error" || current.status === "timeout") {
      return {
        ok: false,
        status: "error",
        text: current.error || "Paired PC job failed.",
        data: { agentId: agent.id, jobId: job.id },
      };
    }
    await sleep(pollMs);
  }
  markJobTimeout(job.id);
  return {
    ok: false,
    status: "error",
    text: "Timed out waiting for the paired PC agent. Nothing was invented.",
    data: { agentId: agent.id, jobId: job.id },
  };
}

/**
 * Run a command a human approved in the UI. The approval names a specific
 * paired PC (agentId + label shown on the approval card); the command must run
 * on THAT PC only. If it is offline, unpaired, or owned by someone else, return
 * null so the caller reports "nothing ran" — never hop to another online PC.
 */
export async function runApprovedOnPairedAgent(input: {
  ownerId: string;
  record: { command: string; agentId: string; agentLabel?: string };
  timeoutMs?: number;
  pollMs?: number;
  now?: number;
}): Promise<PairingRunResult | null> {
  const agentId = typeof input.record.agentId === "string" ? input.record.agentId.trim() : "";
  if (!agentId) return null;
  return runOnPairedAgent({
    ownerId: input.ownerId,
    command: input.record.command,
    confirm: true,
    agentId,
    timeoutMs: input.timeoutMs,
    pollMs: input.pollMs,
    now: input.now,
  });
}
