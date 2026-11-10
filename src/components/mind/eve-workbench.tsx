import { Activity, ArrowUpRight, Bot, CircleAlert, Clock3, FileText, Globe2, ShieldCheck } from "lucide-react";
import type { Workspace } from "@/lib/mind/types";

function stamp(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "Time unavailable";
}

function stateTone(value: string): string {
  if (value === "running" || value === "completed") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (value === "failed" || value === "canceled" || value === "paused") return "border-rose-400/30 bg-rose-400/10 text-rose-200";
  if (value === "waiting_approval" || value === "waiting_external") return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  return "border-line bg-surface-2 text-muted";
}

export function EveWorkbench({
  workspace,
  onOpenChat,
  onOpenDashboard,
  onOpenAgents,
  onOpenRuns,
  onOpenConnections,
}: {
  workspace: Workspace;
  onOpenChat: () => void;
  onOpenDashboard: () => void;
  onOpenAgents: () => void;
  onOpenRuns: () => void;
  onOpenConnections: () => void;
}) {
  const runs = [...workspace.runs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8);
  const events = [...workspace.runEvents].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 10);
  const browsers = [...workspace.browserSessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 4);
  const activeRuns = workspace.runs.filter((run) => run.state === "queued" || run.state === "running" || run.state === "waiting_approval" || run.state === "waiting_external");
  const failedRuns = workspace.runs.filter((run) => run.state === "failed").length;

  return (
    <main className="h-full min-h-0 overflow-auto p-4 md:p-6" data-testid="eve-workbench">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        <header className="masthead flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid size-16 shrink-0 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
              <Bot className="size-8" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Adrian Core · Intelligence</p>
              <h1 className="font-display text-3xl font-bold md:text-4xl">EVE Workbench</h1>
              <p className="mt-1 text-sm text-muted">Primary operator interface · workspace activity and task review</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="EVE workbench destinations">
            <button type="button" onClick={onOpenChat} className="inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink">
              Open Chat <ArrowUpRight className="size-4" />
            </button>
            <button type="button" onClick={onOpenAgents} className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-4 text-sm">
              Agents
            </button>
            <button type="button" onClick={onOpenRuns} className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-4 text-sm">
              Run history
            </button>
            <button type="button" onClick={onOpenConnections} className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-4 text-sm">
              Connections
            </button>
            <button type="button" onClick={onOpenDashboard} className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-4 text-sm">
              3D Dashboard
            </button>
          </nav>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workbench status">
          <div className="rounded-panel border border-line bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Recorded active tasks</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{activeRuns.length}</p>
            <p className="mt-1 text-xs text-muted">Queued, running or awaiting approval in this workspace</p>
          </div>
          <div className="rounded-panel border border-line bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Recorded task failures</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{failedRuns}</p>
            <p className="mt-1 text-xs text-muted">Failed runs retained in the workspace</p>
          </div>
          <div className="rounded-panel border border-line bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Workspace files</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{workspace.files.length}</p>
            <p className="mt-1 text-xs text-muted">Files available to this workspace</p>
          </div>
          <div className="rounded-panel border border-line bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Emergency-stop flag</p>
            <p className={"mt-2 text-xl font-semibold " + (workspace.halted ? "text-rose-300" : "text-emerald-300")}>{workspace.halted ? "ON" : "OFF"}</p>
            <p className="mt-1 text-xs text-muted">Workspace snapshot only; server-side owner control is authoritative</p>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
          <div className="rounded-panel border border-line bg-surface p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold"><Activity className="size-5" /> Task activity</h2>
                <p className="mt-1 text-sm text-muted">Only persisted workspace run records are shown here.</p>
              </div>
              <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">Workspace data</span>
            </div>
            {runs.length === 0 ? (
              <div className="mt-4 rounded-panel border border-dashed border-line p-5">
                <p className="font-medium">No recorded task runs yet</p>
                <p className="mt-1 text-sm text-muted">When an existing agent run is saved, its actual state and timestamps will appear here. This panel does not animate or invent activity.</p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {runs.map((run) => (
                  <li key={run.id} className="rounded-panel border border-line bg-bg/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">{run.goal}</p>
                        <p className="mt-1 text-xs text-muted">Run {run.id.slice(0, 8)} · Step {run.step}/{run.maxSteps} · Updated {stamp(run.updatedAt)}</p>
                      </div>
                      <span className={"rounded-full border px-2 py-1 text-xs " + stateTone(run.state)}>{run.state.replaceAll("_", " ")}</span>
                    </div>
                    {run.result ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{run.result.slice(0, 500)}</p> : null}
                    {run.error ? <p className="mt-2 whitespace-pre-wrap text-sm text-rose-300">{run.error.slice(0, 400)}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <section className="rounded-panel border border-line bg-surface p-4">
              <h2 className="flex items-center gap-2 font-semibold"><Bot className="size-5" /> EVE presence</h2>
              <div className="mt-3 rounded-panel border border-dashed border-line bg-bg/70 p-4">
                <p className="font-medium">Operator identity is ready for the interface.</p>
                <p className="mt-1 text-sm text-muted">The animated digital-human renderer, character rig, facial animation and lip-sync provider are not connected in this build. This panel is not a live avatar.</p>
              </div>
              <p className="mt-3 text-xs text-muted">Conversation personality is saved per chat. It is independent of character appearance and does not add execution permissions.</p>
            </section>

            <section className="rounded-panel border border-line bg-surface p-4">
              <h2 className="flex items-center gap-2 font-semibold"><Globe2 className="size-5" /> Browser workstation</h2>
              {browsers.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No browser-driver session is recorded. Live remote browser control is not connected; no browser activity is being simulated.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {browsers.map((browser) => (
                    <li key={browser.id} className="rounded-panel border border-line p-3">
                      <p className="break-all text-sm font-medium">{browser.title || browser.url}</p>
                      <p className="mt-1 text-xs text-muted">{browser.status} · {browser.lastAction || "No action recorded"} · {stamp(browser.updatedAt)}</p>
                      {browser.excerpt ? <p className="mt-2 line-clamp-3 text-xs text-muted">{browser.excerpt}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-panel border border-line bg-surface p-4">
            <h2 className="flex items-center gap-2 font-semibold"><Clock3 className="size-5" /> Recorded run events</h2>
            {events.length === 0 ? <p className="mt-2 text-sm text-muted">No run events have been recorded.</p> : (
              <ul className="mt-3 space-y-2">
                {events.map((event) => (
                  <li key={event.id} className="border-l-2 border-line pl-3">
                    <p className="text-sm font-medium">{event.kind.replaceAll("_", " ")}</p>
                    <p className="text-xs text-muted">{event.detail}</p>
                    <p className="mt-1 text-[11px] text-muted">{stamp(event.at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-panel border border-line bg-surface p-4">
            <h2 className="flex items-center gap-2 font-semibold"><FileText className="size-5" /> Workbench availability</h2>
            <ul className="mt-3 space-y-3 text-sm">
              <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" /><span>Existing chat, workspace memory and owner approval gates are reused.</span></li>
              <li className="flex items-start gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" /><span>Paperclip control-plane connection is deferred until its host and credentials are supplied by the separate setup work.</span></li>
              <li className="flex items-start gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" /><span>Always-on hosted worker, independent browser execution and server-side durable task streaming are not verified by this interface.</span></li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
