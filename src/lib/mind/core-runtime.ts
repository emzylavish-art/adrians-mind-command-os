import { haltFleet, runDueSchedules, tickFleet } from "./fleet.ts";
import type { AgentRun, TickEnv } from "./fleet.ts";
import type { Workspace } from "./types.ts";

export type CorePassSummary = {
  halted: boolean;
  queuedNew: number;
  active: number;
  counts: RunCounts;
  message: string;
};

export type RunCounts = { executing: number; queued: number; waitingApproval: number; waitingExternal: number; cancellationPending: number; paused: number; unresolved: number };
export function countRuns(runs: AgentRun[]): RunCounts {
  const count = (state: AgentRun["state"]) => runs.filter((run) => run.state === state).length;
  const counts = { executing: count("running"), queued: count("queued"), waitingApproval: count("waiting_approval"), waitingExternal: count("waiting_external"), cancellationPending: count("cancel_requested"), paused: count("paused"), unresolved: 0 };
  counts.unresolved = counts.executing + counts.queued + counts.waitingApproval + counts.waitingExternal + counts.cancellationPending + counts.paused;
  return counts;
}

/**
 * One durable orchestration pass over a saved workspace.
 * Local tools may complete. Search, browser, mail and models are not called.
 * A halt cancels open runs and pauses schedules. It does not delete logs or memory.
 */
export function applyCorePass(input: {
  workspace: Workspace;
  now: string;
  workerId: string;
  environment?: TickEnv["environment"];
}): { workspace: Workspace; summary: CorePassSummary } {
  if (input.workspace.halted) {
    const stopped = haltFleet(input.workspace, input.now);
    const schedules = stopped.schedules.map((job) => (job.enabled ? { ...job, enabled: false } : job));
    const workspace = { ...stopped, schedules };
    const counts = countRuns(workspace.runs);
    const active = counts.unresolved;
    return {
      workspace,
      summary: {
        halted: true,
        queuedNew: 0,
        active,
        counts,
        message: "Emergency stop is on. Cancellable runs were canceled and schedules were paused. Logs and memory were kept. Nothing new was started.",
      },
    };
  }
  const before = new Set(input.workspace.runs.map((run) => run.id));
  const due = runDueSchedules(input.workspace, input.now, input.environment);
  const next = tickFleet(due, { now: input.now, workerId: input.workerId, runtime: "server-local", environment: input.environment });
  const queuedNew = next.runs.filter((run) => !before.has(run.id)).length;
  const counts = countRuns(next.runs);
  const active = counts.unresolved;
  return {
    workspace: next,
    summary: {
      halted: false,
      queuedNew,
      active,
      counts,
      message: `Server workspace stepped once. ${queuedNew} new run(s) came from due schedules. No model, Paperclip agent, browser or mailbox was called.`,
    },
  };
}
