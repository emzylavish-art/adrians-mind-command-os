import {
  approveRunAction,
  cancelRun,
  enqueueRun,
  pauseRun,
  resumeRun,
  setScheduleEnabled,
  tickFleet,
} from "./fleet.ts";
import type { Workspace } from "./types.ts";

export type WorkbenchCommand =
  | { type: "pause"; runId: string }
  | { type: "resume"; runId: string }
  | { type: "cancel"; runId: string }
  | { type: "approve"; runId: string; action: "browser" | "gmail_send" }
  | { type: "step" }
  | { type: "enqueue"; agentId: string; goal: string }
  | { type: "set_schedule"; id: string; enabled: boolean };

export type WorkbenchCommandResult = {
  ok: boolean;
  message: string;
  workspace: Workspace;
};

export function applyWorkbenchCommand(
  workspace: Workspace,
  command: WorkbenchCommand,
  now = new Date().toISOString(),
): WorkbenchCommandResult {
  if (workspace.halted && command.type !== "cancel") {
    return {
      ok: false,
      message: "Emergency stop is on. No new or resumed work was started.",
      workspace,
    };
  }
  if (command.type === "pause") {
    const run = workspace.runs.find((item) => item.id === command.runId);
    if (!run) return { ok: false, message: "That run is not in this workspace.", workspace };
    const next = pauseRun(workspace, command.runId);
    const updated = next.runs.find((item) => item.id === command.runId);
    if (run.state === "paused" || !updated || updated.state !== "paused") {
      return { ok: false, message: `This run is ${run.state.replaceAll("_", " ")} and was not paused.`, workspace };
    }
    return { ok: true, message: "Run paused. It will not be stepped until you resume it.", workspace: next };
  }
  if (command.type === "resume") {
    const before = workspace.runs.find((item) => item.id === command.runId);
    const next = resumeRun(workspace, command.runId);
    const updated = next.runs.find((item) => item.id === command.runId);
    if (!before || !["paused", "waiting_external"].includes(before.state) || !updated || updated.state !== "queued") {
      return { ok: false, message: "Only a paused run or a run waiting for an external service can be resumed. Nothing was queued.", workspace };
    }
    return { ok: true, message: "Run resumed and queued. It has not been executed until the worker steps.", workspace: next };
  }
  if (command.type === "cancel") {
    const before = workspace.runs.find((item) => item.id === command.runId);
    if (!before) return { ok: false, message: "That run is not in this workspace.", workspace };
    const next = cancelRun(workspace, command.runId, now);
    const updated = next.runs.find((item) => item.id === command.runId);
    if (before.state === "canceled" || !updated || updated.state !== "canceled") {
      return { ok: false, message: `This run is already ${before.state.replaceAll("_", " ")}. It was not changed.`, workspace };
    }
    return { ok: true, message: updated.error || "Run canceled. Unfinished work was not marked complete.", workspace: next };
  }
  if (command.type === "approve") {
    const run = workspace.runs.find((item) => item.id === command.runId);
    if (!run || run.state !== "waiting_approval") {
      return { ok: false, message: "Nothing is waiting for that approval.", workspace };
    }
    const next = approveRunAction(workspace, command.runId, command.action, now);
    if (next === workspace) return { ok: false, message: "That action does not match the pending plan step. No approval was recorded.", workspace };
    return {
      ok: true,
      message: `Approved ${command.action.replaceAll("_", " ")} for this run. The action still waits for a worker step and a real driver.`,
      workspace: next,
    };
  }
  if (command.type === "step") {
    const next = tickFleet(workspace, { now, workerId: "browser-worker" });
    const changes = next.runs.filter((run) => {
      const before = workspace.runs.find((item) => item.id === run.id);
      return !before || before.state !== run.state || before.step !== run.step || before.result !== run.result || before.error !== run.error;
    });
    if (!changes.length) return { ok: false, message: "No eligible step advanced. Runs may be paused, awaiting approval or an external service, complete, or leased to another worker.", workspace };
    const counts = changes.reduce((summary, run) => { summary[run.state] = (summary[run.state] ?? 0) + 1; return summary; }, {} as Record<string, number>);
    return { ok: true, message: `Worker checked ${changes.length} run${changes.length === 1 ? "" : "s"}: ${Object.entries(counts).map(([state, count]) => `${count} ${state.replaceAll("_", " ")}`).join(", ")}. Only completed runs finished their saved plan.`, workspace: next };
  }
  if (command.type === "enqueue") {
    const queued = enqueueRun(workspace, command.agentId, command.goal, now);
    if (!queued.ok) return { ok: false, message: queued.error, workspace };
    return { ok: true, message: "Task queued on this device. It has not run yet.", workspace: queued.ws };
  }
  const job = workspace.schedules.find((item) => item.id === command.id);
  if (!job) return { ok: false, message: "That schedule is not in this workspace.", workspace };
  if (job.enabled === command.enabled) return { ok: false, message: `Schedule is already ${job.enabled ? "enabled" : "paused"}. Nothing changed.`, workspace };
  return {
    ok: true,
    message: command.enabled ? "Schedule enabled. It runs on the next due check, not immediately." : "Schedule paused. It will not queue new runs.",
    workspace: setScheduleEnabled(workspace, command.id, command.enabled, now),
  };
}
