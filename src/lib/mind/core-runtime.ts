import { haltFleet, runDueSchedules, tickFleet } from "./fleet.ts";
import type { Workspace } from "./types.ts";

export type CorePassSummary = {
  halted: boolean;
  queuedNew: number;
  active: number;
  message: string;
};

/**
 * One durable orchestration pass over a saved workspace.
 * Local tools may complete. Search, browser, mail and models are not called.
 * A halt cancels open runs and pauses schedules. It does not delete logs or memory.
 */
export function applyCorePass(input: {
  workspace: Workspace;
  now: string;
  workerId: string;
}): { workspace: Workspace; summary: CorePassSummary } {
  if (input.workspace.halted) {
    const stopped = haltFleet(input.workspace, input.now);
    const schedules = stopped.schedules.map((job) => (job.enabled ? { ...job, enabled: false } : job));
    const workspace = { ...stopped, schedules };
    const active = workspace.runs.filter((run) => run.state === "queued" || run.state === "running").length;
    return {
      workspace,
      summary: {
        halted: true,
        queuedNew: 0,
        active,
        message: "Emergency stop is on. Cancellable runs were canceled and schedules were paused. Logs and memory were kept. Nothing new was started.",
      },
    };
  }
  const before = new Set(input.workspace.runs.map((run) => run.id));
  const due = runDueSchedules(input.workspace, input.now);
  const next = tickFleet(due, { now: input.now, workerId: input.workerId });
  const queuedNew = next.runs.filter((run) => !before.has(run.id)).length;
  const active = next.runs.filter((run) => run.state === "queued" || run.state === "running" || run.state === "waiting_approval" || run.state === "waiting_external").length;
  return {
    workspace: next,
    summary: {
      halted: false,
      queuedNew,
      active,
      message: `Server workspace stepped once. ${queuedNew} new run(s) came from due schedules. No model, Paperclip agent, browser or mailbox was called.`,
    },
  };
}
