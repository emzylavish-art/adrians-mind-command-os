import {
  enqueueJob,
  markJobTimeout,
  onlineAgents,
  readJob,
  type PairedAgent,
} from "./coordination.server.ts";

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
  agentId?: string;
  /** Server-authorized only (allowlist or consumed human approval). */
  confirm: boolean;
  timeoutMs?: number;
  pollMs?: number;
  now?: number;
}): Promise<PairingRunResult | null> {
  const online = await onlineAgents(input.ownerId, 60_000, input.now ?? Date.now());
  if (online.length === 0) return null;
  if (input.agentId && !online.some((agent) => agent.id === input.agentId)) return { ok: false, status: "error", text: "The selected computer is unavailable. No other computer was substituted." };
  if (!input.agentId && online.length > 1) return { ok: false, status: "error", text: "Choose the intended computer before executing this command." };
  const agent: PairedAgent = input.agentId ? online.find((agent) => agent.id === input.agentId)! : online[0]!;
  const job = await enqueueJob({
    ownerId: input.ownerId,
    agentId: agent.id,
    command: input.command,
    confirm: input.confirm,
  });
  const timeoutMs = input.timeoutMs ?? 15_000;
  const pollMs = input.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await readJob(job.id);
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
  await markJobTimeout(job.id);
  return {
    ok: false,
    status: "error",
    text: "Timed out waiting for the paired PC agent. Nothing was invented.",
    data: { agentId: agent.id, jobId: job.id },
  };
}
