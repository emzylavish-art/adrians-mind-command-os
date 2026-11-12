import { useEffect, useState } from "react";
import { Activity, ArrowUpRight, Bot, CircleAlert, Clock3, FileText, Globe2, ShieldCheck } from "lucide-react";
import { DigitalHuman, readStoredFraming, writeStoredFraming } from "@/components/mind/avatar/digital-human";
import { AVATAR_EXPRESSIONS, type AvatarExpression, type AvatarFraming } from "@/lib/mind/avatar/presence";
import { MIND_CHARACTERS, readStoredCharacterId, rosterAvailability, writeStoredCharacterId } from "@/lib/mind/characters";
import { paperclipStatus, runDurableCorePass } from "@/lib/mind/server";
import { CONVERSATIONAL_PERSONALITIES, resolvePersonalityId } from "@/lib/mind/personalities";
import type { WorkbenchCommand } from "@/lib/mind/workbench-command";
import { writeStoredVoiceChoice } from "@/lib/mind/voice/voices";
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

type PaperclipView = {
  state: "not_configured" | "unavailable" | "connected";
  message: string;
  checkedAt: string;
  agents: { id: string }[];
  runs: { id: string }[];
};

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function EveWorkbench({
  workspace,
  onOpenChat,
  onOpenDashboard,
  onOpenAgents,
  onOpenRuns,
  onOpenConnections,
  onCommand,
  onToggleStop,
  onPreviewVoice,
  personalityId,
  customPersonality,
  chatTitle,
}: {
  workspace: Workspace;
  onOpenChat: () => void;
  onOpenDashboard: () => void;
  onOpenAgents: () => void;
  onOpenRuns: () => void;
  onOpenConnections: () => void;
  onCommand: (command: WorkbenchCommand) => void;
  onToggleStop: () => void;
  onPreviewVoice?: (line: string) => void;
  personalityId?: string;
  customPersonality?: string;
  chatTitle?: string;
}) {
  const runs = [...workspace.runs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const visibleRuns = runs.slice(0, 12);
  const events = [...workspace.runEvents].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 12);
  const browsers = [...workspace.browserSessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 4);
  const activeRuns = workspace.runs.filter((run) => run.state === "queued" || run.state === "running" || run.state === "waiting_approval" || run.state === "waiting_external");
  const queued = workspace.runs.filter((run) => run.state === "queued").length;
  const running = workspace.runs.filter((run) => run.state === "running").length;
  const failedRuns = workspace.runs.filter((run) => run.state === "failed").length;
  const waiting = workspace.runs.filter((run) => run.state === "waiting_approval").length;
  const agents = workspace.agents.filter((agent) => !agent.archived);
  const firstAgentId = agents[0]?.id ?? "";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((run) => run.id === selectedId) ?? visibleRuns[0] ?? null;
  const [goal, setGoal] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [characterId, setCharacterId] = useState(() => readStoredCharacterId(storageOrNull()));
  const [framing, setFraming] = useState<AvatarFraming>(() => readStoredFraming());
  const [expression, setExpression] = useState<AvatarExpression | null>(null);
  const [paperclip, setPaperclip] = useState<PaperclipView | null>(null);
  const [paperclipError, setPaperclipError] = useState<string | null>(null);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const roster = rosterAvailability();
  const style = CONVERSATIONAL_PERSONALITIES.find((item) => item.id === resolvePersonalityId(personalityId));

  useEffect(() => {
    if (!agentId && firstAgentId) setAgentId(firstAgentId);
  }, [agentId, firstAgentId]);

  useEffect(() => {
    let canceled = false;
    void paperclipStatus()
      .then((snapshot) => {
        if (!canceled) setPaperclip(snapshot);
      })
      .catch(() => {
        if (!canceled) setPaperclipError("Paperclip status could not be read. No agents were marked live.");
      });
    return () => {
      canceled = true;
    };
  }, []);

  function refreshPaperclip() {
    setPaperclipError(null);
    void paperclipStatus()
      .then((snapshot) => setPaperclip(snapshot))
      .catch(() => setPaperclipError("Paperclip status could not be read. No agents were marked live."));
  }

  function chooseCharacter(id: string) {
    const character = writeStoredCharacterId(id, storageOrNull());
    writeStoredVoiceChoice(character.voiceId, storageOrNull());
    setCharacterId(character.id);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("amcos-character"));
  }

  function openFile(file: Workspace["files"][number]) {
    const blob = new Blob([file.text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name || "artifact.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function stepServerCopy() {
    setServerBusy(true);
    setServerNote(null);
    try {
      const result = await runDurableCorePass();
      setServerNote(result.ok ? `${result.message} The open browser workspace was not replaced.` : result.error);
    } catch {
      setServerNote("The server pass did not answer. Nothing was marked complete.");
    } finally {
      setServerBusy(false);
    }
  }

  return (
    <main className="h-full min-h-0 overflow-auto p-4 md:p-6" data-testid="eve-workbench">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        <header className="page-hero flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid size-16 shrink-0 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
              <Bot className="size-8" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Adrian Core · Intelligence</p>
              <h1 className="font-display text-3xl font-bold md:text-4xl">EVE Workbench</h1>
              <p className="mt-1 text-sm text-muted">Operator controls for saved tasks. Empty means nothing is recorded.</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="EVE workbench destinations">
            <button type="button" onClick={onOpenChat} className="inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink">
              Open Chat <ArrowUpRight className="size-4" />
            </button>
            <button type="button" onClick={onOpenAgents} className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-4 text-sm">Agents</button>
            <button type="button" onClick={onOpenRuns} className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-4 text-sm">Run history</button>
            <button type="button" onClick={onOpenConnections} className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-4 text-sm">Connections</button>
            <button type="button" onClick={onOpenDashboard} className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-4 text-sm">3D Dashboard</button>
          </nav>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workbench status">
          <div className="rounded-panel border border-line bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Active tasks</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{activeRuns.length}</p>
            <p className="mt-1 text-xs text-muted">{queued} queued · {running} running · {waiting} awaiting approval</p>
          </div>
          <div className="rounded-panel border border-line bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Failed tasks</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{failedRuns}</p>
            <p className="mt-1 text-xs text-muted">Failed runs kept in this workspace</p>
          </div>
          <div className="rounded-panel border border-line bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Files</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{workspace.files.length}</p>
            <p className="mt-1 text-xs text-muted">Saved text artifacts on this device</p>
          </div>
          <div className="rounded-panel border border-line bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Emergency stop</p>
            <p className={"mt-2 text-xl font-semibold " + (workspace.halted ? "text-rose-300" : "text-emerald-300")}>{workspace.halted ? "ON" : "OFF"}</p>
            <button type="button" onClick={onToggleStop} className="mt-3 inline-flex min-h-11 items-center rounded-panel border border-line px-3 text-sm">
              {workspace.halted ? "Clear stop" : "Emergency stop"}
            </button>
          </div>
        </section>

        <section className="rounded-panel border border-line bg-surface p-4 md:p-5">
          <h2 className="text-lg font-semibold">Start a local task</h2>
          <p className="mt-1 text-sm text-muted">Queues a saved agent on this device. It does not call Paperclip or a paid model.</p>
          <form
            className="mt-3 grid gap-2 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              if (!agentId) return;
              onCommand({ type: "enqueue", agentId, goal });
              setGoal("");
            }}
          >
            <label className="grid gap-1 text-xs text-muted">
              Agent
              <select value={agentId} onChange={(event) => setAgentId(event.target.value)} className="min-h-11 rounded-panel border border-line bg-bg px-3 text-sm text-fg" disabled={agents.length === 0 || workspace.halted}>
                {agents.length === 0 ? <option value="">No saved agent</option> : agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Goal
              <input value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={2000} placeholder="What should this agent do with stored data?" className="min-h-11 rounded-panel border border-line bg-bg px-3 text-sm text-fg" disabled={workspace.halted} />
            </label>
            <button type="submit" className="inline-flex min-h-11 items-center justify-center self-end rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50" disabled={workspace.halted || !agentId || !goal.trim()}>
              Queue task
            </button>
          </form>
          {agents.length === 0 ? <p className="mt-2 text-sm text-muted">No local agent is saved. Add one on Agents. Nothing was queued.</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="inline-flex min-h-11 items-center rounded-panel border border-line px-3 text-sm disabled:opacity-50" disabled={workspace.halted} onClick={() => onCommand({ type: "step" })}>
              Step local worker
            </button>
            <button type="button" className="inline-flex min-h-11 items-center rounded-panel border border-line px-3 text-sm disabled:opacity-50" disabled={serverBusy} onClick={() => void stepServerCopy()}>
              {serverBusy ? "Stepping server copy…" : "Step saved server copy"}
            </button>
          </div>
          {serverNote ? <p className="mt-2 text-sm text-muted" role="status">{serverNote}</p> : null}
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
          <div className="rounded-panel border border-line bg-surface p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold"><Activity className="size-5" /> Task activity</h2>
                <p className="mt-1 text-sm text-muted">Controls call the local fleet. They do not invent progress.</p>
              </div>
            </div>
            {visibleRuns.length === 0 ? (
              <div className="mt-4 rounded-panel border border-dashed border-line p-5">
                <p className="font-medium">No recorded task runs yet</p>
                <p className="mt-1 text-sm text-muted">Queue a saved agent or wait for a due schedule. This panel does not animate activity.</p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {visibleRuns.map((run) => {
                  const agent = agents.find((item) => item.id === run.agentId);
                  return (
                    <li key={run.id} className="rounded-panel border border-line bg-bg/70 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <button type="button" className="min-w-0 text-left" onClick={() => setSelectedId(run.id)}>
                          <p className="break-words text-sm font-medium">{run.goal}</p>
                          <p className="mt-1 text-xs text-muted">{agent?.name ?? "Unknown agent"} · Run {run.id.slice(0, 8)} · Step {run.step}/{run.maxSteps} · Updated {stamp(run.updatedAt)}</p>
                        </button>
                        <span className={"rounded-full border px-2 py-1 text-xs " + stateTone(run.state)}>{run.state.replaceAll("_", " ")}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onCommand({ type: "pause", runId: run.id })}>Pause</button>
                        <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onCommand({ type: "resume", runId: run.id })}>Resume</button>
                        <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onCommand({ type: "cancel", runId: run.id })}>Cancel</button>
                        {run.state === "waiting_approval" ? (
                          <>
                            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onCommand({ type: "approve", runId: run.id, action: "browser" })}>Approve browser</button>
                            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onCommand({ type: "approve", runId: run.id, action: "gmail_send" })}>Approve send</button>
                          </>
                        ) : null}
                      </div>
                      {run.result ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{run.result.slice(0, 500)}</p> : null}
                      {run.error ? <p className="mt-2 whitespace-pre-wrap text-sm text-rose-300">{run.error.slice(0, 400)}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {selected ? (
              <div className="mt-4 rounded-panel border border-dashed border-line p-3" data-testid="eve-run-detail">
                <h3 className="text-sm font-semibold">Selected task</h3>
                <p className="mt-1 text-sm">{selected.goal}</p>
                <p className="mt-1 text-xs text-muted">State {selected.state} · worker {selected.workerId ?? "none"} · created {stamp(selected.createdAt)}</p>
                {selected.plan.length > 0 ? (
                  <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted">
                    {selected.plan.map((step) => <li key={step.id}>{step.title} · {step.tool}</li>)}
                  </ol>
                ) : <p className="mt-2 text-xs text-muted">No plan was stored for this run.</p>}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <section className="rounded-panel border border-line bg-surface p-4">
              <h2 className="flex items-center gap-2 font-semibold"><Bot className="size-5" /> Digital human</h2>
              <p className="mt-1 text-xs text-muted">{roster.femaleFilled} of {roster.femaleFilled + roster.femaleOpen} female identities filled. {roster.maleFilled} of {roster.maleOpen} male identities filled. Same Adrian Core. No extra permissions.</p>
              <DigitalHuman characterId={characterId} framing={framing} expression={expression} className="mt-3" />
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Avatar framing">
                {(["full", "upper", "face", "compact"] as AvatarFraming[]).map((mode) => (
                  <button key={mode} type="button" className={"min-h-11 rounded-panel border px-3 text-xs " + (framing === mode ? "border-accent bg-accent/10" : "border-line")} onClick={() => { setFraming(mode); writeStoredFraming(mode); }}>{mode}</button>
                ))}
              </div>
              <label className="mt-3 grid gap-1 text-xs text-muted">
                Expression
                <select className="min-h-11 rounded-panel border border-line bg-bg px-3 text-sm text-fg" value={expression ?? "auto"} onChange={(event) => setExpression(event.target.value === "auto" ? null : event.target.value as AvatarExpression)}>
                  <option value="auto">Follow live state</option>
                  {AVATAR_EXPRESSIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <p className="mt-2 text-sm">Active chat: {chatTitle || "No chat open"} · style {style?.label ?? "Assistant"}{resolvePersonalityId(personalityId) === "custom" && customPersonality ? ` · “${customPersonality.slice(0, 80)}”` : ""}</p>
              <button
                type="button"
                className="mt-2 inline-flex min-h-11 items-center rounded-panel border border-line px-3 text-sm"
                onClick={() => onPreviewVoice?.(`Hello. I am ${MIND_CHARACTERS.find((item) => item.id === characterId)?.name ?? "EVE"}.`)}
              >
                Play voice preview
              </button>
              <p className="mt-1 text-xs text-muted">Preview speaks only if a speech key is configured. It does not invent audio. Lip sync follows that playback.</p>
              <div className="mt-3 grid gap-2">
                {MIND_CHARACTERS.map((character) => (
                  <button key={character.id} type="button" onClick={() => chooseCharacter(character.id)} className={"rounded-panel border px-3 py-2 text-left " + (characterId === character.id ? "border-accent bg-accent/10" : "border-line")} aria-pressed={characterId === character.id}>
                    <span className="block text-sm font-semibold">{character.name} · {character.role}</span>
                    <span className="block text-xs text-muted">Voice {character.voiceId}. {character.summary}</span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">The figure is an original 3D body in the page. The face is EVE's photograph on that head, and the mouth follows speech. It is not a purchased face rig. Full-body framing shows the modeled body. A licensed GLB was not added.</p>
            </section>

            <section className="rounded-panel border border-line bg-surface p-4">
              <h2 className="flex items-center gap-2 font-semibold"><Globe2 className="size-5" /> Browser sessions</h2>
              {browsers.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No browser session is recorded. Remote browsing is not running.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {browsers.map((browser) => (
                    <li key={browser.id} className="rounded-panel border border-line p-3">
                      <p className="break-all text-sm font-medium">{browser.title || browser.url}</p>
                      <p className="mt-1 text-xs text-muted">{browser.status} · {browser.lastAction || "No action recorded"} · {stamp(browser.updatedAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-panel border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">Paperclip</h2>
                <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={refreshPaperclip}>Refresh</button>
              </div>
              <p className="mt-2 text-sm text-muted" role="status">{paperclipError ?? paperclip?.message ?? "Checking Paperclip…"}</p>
              {paperclip?.state === "connected" ? (
                <p className="mt-2 text-xs text-muted">{paperclip.agents.length} agent(s), {paperclip.runs.length} heartbeat run(s). Checked {stamp(paperclip.checkedAt)}.</p>
              ) : null}
            </section>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-panel border border-line bg-surface p-4">
            <h2 className="font-semibold">Agent health</h2>
            {agents.length === 0 ? <p className="mt-2 text-sm text-muted">No saved agents.</p> : (
              <ul className="mt-3 space-y-2 text-sm">
                {agents.map((agent) => {
                  const deployment = workspace.deployments.find((item) => item.agentId === agent.id);
                  return (
                    <li key={agent.id} className="rounded-panel border border-line p-3">
                      <p className="font-medium">{agent.name}</p>
                      <p className="text-xs text-muted">{deployment ? `${deployment.target} · ${deployment.state}` : "Not deployed"}{deployment?.error ? ` · ${deployment.error}` : ""}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="rounded-panel border border-line bg-surface p-4">
            <h2 className="font-semibold">Schedules</h2>
            {workspace.schedules.length === 0 ? <p className="mt-2 text-sm text-muted">No schedules are saved.</p> : (
              <ul className="mt-3 space-y-2">
                {workspace.schedules.map((job) => (
                  <li key={job.id} className="rounded-panel border border-line p-3 text-sm">
                    <p className="font-medium">{job.name}</p>
                    <p className="text-xs text-muted">{job.enabled ? "Enabled" : "Paused"} · next {stamp(job.nextRunAt)}</p>
                    <button type="button" className="mt-2 min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onCommand({ type: "set_schedule", id: job.id, enabled: !job.enabled })}>
                      {job.enabled ? "Pause schedule" : "Enable schedule"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-panel border border-line bg-surface p-4">
            <h2 className="flex items-center gap-2 font-semibold"><FileText className="size-5" /> Artifacts</h2>
            {workspace.files.length === 0 ? <p className="mt-2 text-sm text-muted">No files are stored.</p> : (
              <ul className="mt-3 space-y-2">
                {workspace.files.slice(0, 8).map((file) => (
                  <li key={file.id}>
                    <button type="button" className="min-h-11 text-left text-sm underline" onClick={() => openFile(file)}>{file.name}</button>
                    <p className="text-xs text-muted">{file.bytes} bytes · {stamp(file.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-panel border border-line bg-surface p-4">
            <h2 className="flex items-center gap-2 font-semibold"><Clock3 className="size-5" /> Recorded events</h2>
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
            <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5" /> What is actually connected</h2>
            <ul className="mt-3 space-y-3 text-sm">
              <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" /><span>Local queue, pause, resume, cancel, schedule pause and emergency stop use the saved workspace.</span></li>
              <li className="flex items-start gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" /><span>{paperclip?.state === "connected" ? "Paperclip answered a health check for the configured company." : "Paperclip is not connected for this account. No remote agent is live."}</span></li>
              <li className="flex items-start gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" /><span>Lip-sync, a hosted always-on process, and external OAuth actions are not claimed by this screen.</span></li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
