import { countRuns } from "../../lib/mind/core-runtime.ts";
import type { AgentRun } from "../../lib/mind/fleet.ts";

export function RunCountsView({ runs }: { runs: AgentRun[] }) {
  const counts = countRuns(runs);
  const fields = [["Executing", counts.executing], ["Queued", counts.queued], ["Waiting for approval", counts.waitingApproval], ["Waiting externally", counts.waitingExternal], ["Cancellation pending", counts.cancellationPending], ["Paused", counts.paused], ["Unresolved total", counts.unresolved]] as const;
  return <dl aria-label="Run status counts" className="mt-3 grid grid-cols-2 gap-2 rounded-panel border border-line p-3 text-xs sm:grid-cols-4">{fields.map(([label, count]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 font-semibold">{count}</dd></div>)}</dl>;
}

export function RunEvidence({ run }: { run: AgentRun }) {
  const runtime = run.executionRuntime === "server-local" ? "Server local worker" : run.executionRuntime === "scheduled-local" ? "Local schedule worker" : run.executionRuntime === "browser-local" ? "Browser local worker" : "Runtime not recorded";
  return <dl aria-label="Run execution evidence" className="mt-2 space-y-1 text-xs text-muted">
    <div><dt className="inline">Execution runtime: </dt><dd className="inline">{runtime}. This record does not establish a remote agent or model call.</dd></div>
    <div><dt className="inline">Plan revision: </dt><dd className="inline">{run.definition ? `Agent revision ${run.definition.version}; ${run.definition.maxSteps} step limit; tool order preserved.` : "Legacy run has no immutable plan. Review and create a new run before resuming."}</dd></div>
    <div><dt className="inline">Execution outcome: </dt><dd className="inline">{run.completion?.execution === "budget_exhausted" ? "Step allowance exhausted" : run.completion?.execution === "no_results" ? "No usable result" : run.completion?.execution === "finished" ? "Planned local steps finished" : run.state.replaceAll("_", " ")}</dd></div>
    <div><dt className="inline">Objective verification: </dt><dd className="inline">Unverified. A finished sequence alone does not prove the user's objective was achieved.</dd></div>
    {run.cancellation && <div><dt className="inline">Cancellation: </dt><dd className="inline">Requested {new Date(run.cancellation.requestedAt).toLocaleString()}; {run.cancellation.acknowledgedAt ? `local worker acknowledged ${new Date(run.cancellation.acknowledgedAt).toLocaleString()}` : "acknowledgment pending"}. Completed results remain in this run.</dd></div>}
  </dl>;
}
