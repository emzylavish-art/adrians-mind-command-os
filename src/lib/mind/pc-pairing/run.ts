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
  agentId?: string;
  cwd?: string;
  /** Server-authorized only (allowlist or consumed human approval). */
  confirm: boolean;
  timeoutMs?: number;
  pollMs?: number;
  now?: number;
}): Promise<PairingRunResult | null> {
  const online = onlineAgents(input.ownerId, 60_000, input.now ?? Date.now());
  if (online.length === 0) return null;
  const agent: PairedAgent | undefined = input.agentId ? online.find((item) => item.id === input.agentId) : online[0];
  if (!agent) return null;
  if (input.cwd && agent.fileProtocol !== 2) return { ok: false, status: "error", text: "Update the selected Companion before running in an explicitly reviewed workspace. Nothing ran." };
  const job = enqueueJob({
    ownerId: input.ownerId,
    agentId: agent.id,
    command: input.command,
    confirm: input.confirm,
    ...(input.cwd ? { payload: { cwd: input.cwd } } : {}),
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
