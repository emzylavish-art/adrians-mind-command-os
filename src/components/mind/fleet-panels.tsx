import { useEffect, useState } from "react";
import { inspectWebPage, workerHealth } from "@/lib/mind/server";
import {
  AGENT_TEMPLATES,
  FLEET_TOOLS,
  addAgentFromTemplate,
  addConnection,
  addCustomAgent,
  addMailbox,
  addSchedule,
  setScheduleEnabled,
  approveRunAction,
  cancelRun,
  deployAgent,
  enqueueRun,
  gmailConnectAttempt,
  pauseRun,
  resumeRun,
  runDueSchedules,
  tickFleet,
  togglePin,
  toolCatalog,
  type FleetTool,
  type ProviderConnection,
} from "@/lib/mind/fleet";
import type { Workspace } from "@/lib/mind/types";

export function FleetPanel({
  mode,
  ws,
  setWs,
}: {
  mode: "agents" | "runs" | "connected" | "scheduled" | "tools";
  ws: Workspace;
  setWs: (updater: (prev: Workspace) => Workspace) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [agentId, setAgentId] = useState("");
  const [mailLabel, setMailLabel] = useState("");
  const [mailAddress, setMailAddress] = useState("");
  const [connectionLabel, setConnectionLabel] = useState("");
  const [provider, setProvider] = useState<ProviderConnection["provider"]>("openai");
  const [jobName, setJobName] = useState("");
  const [jobZone, setJobZone] = useState("America/Chicago");
  const [jobHour, setJobHour] = useState("");
  const [workerNote, setWorkerNote] = useState("Checking the worker.");
  const [pageUrl, setPageUrl] = useState("");
  const [pageNote, setPageNote] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [customTools, setCustomTools] = useState<FleetTool[]>(["list_projects"]);
  const active = ws.agents.find((agent) => agent.id === agentId && !agent.archived) ?? ws.agents.find((agent) => !agent.archived) ?? null;

  useEffect(() => {
    if (mode !== "scheduled") return;
    void workerHealth()
      .then((health) => setWorkerNote(health.detail))
      .catch(() => setWorkerNote("Worker status could not be read. Nothing is reported as online."));
  }, [mode]);

  function apply(result: { ok: true; ws: Workspace } | { ok: false; error: string }) {
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setWs(() => result.ws);
    setNote(null);
  }

  if (mode === "agents") {
    return (
      <section className="mx-4 mb-6 rounded-panel border border-line bg-surface p-4 md:mx-6">
        <h3 className="font-semibold">Agent directory</h3>
        <p className="mt-1 text-sm text-muted">Templates are definitions. A saved agent is not deployed. Local ready means the Run worker button in this app can execute it. Hosted stays external until a worker process exists.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {AGENT_TEMPLATES.map((template) => (
            <button key={template.name} type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => apply(addAgentFromTemplate(ws, template.name))}>
              Add {template.name}
            </button>
          ))}
        </div>
        <div className="mt-4 rounded-panel border border-line p-3">
          <p className="font-semibold">Custom agent</p>
          <p className="mt-1 text-sm text-muted">Selected tools that are not configured wait. They do not report success.</p>
          <input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Agent name" className="mt-2 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
          <textarea value={customInstructions} onChange={(event) => setCustomInstructions(event.target.value)} placeholder="Instructions" rows={3} className="mt-2 w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
          <div className="mt-2 flex flex-wrap gap-2">
            {FLEET_TOOLS.map((tool) => {
              const on = customTools.includes(tool);
              return (
                <button
                  key={tool}
                  type="button"
                  className={`min-h-11 rounded-panel border px-3 text-sm ${on ? "border-accent bg-accent text-accent-ink" : "border-line"}`}
                  onClick={() => setCustomTools((current) => (current.includes(tool) ? current.filter((item) => item !== tool) : [...current, tool]))}
                >
                  {tool}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="mt-3 min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
            onClick={() => apply(addCustomAgent(ws, { name: customName, instructions: customInstructions, tools: customTools }))}
          >
            Save agent
          </button>
        </div>
        <ul className="mt-4 space-y-3">
          {ws.agents.length === 0 && <li className="text-sm text-muted">No agents yet.</li>}
          {ws.agents.filter((agent) => !agent.archived).map((agent) => {
            const deployment = ws.deployments.find((item) => item.agentId === agent.id);
            return (
              <li key={agent.id} className="rounded-panel border border-line p-3 text-sm">
                <p className="font-semibold">{agent.name}</p>
                <p className="text-muted">{agent.description}</p>
                <p className="mt-1 text-xs text-muted">Tools: {agent.tools.join(", ") || "none"}. Version {agent.version}. {deployment ? `${deployment.target} · ${deployment.state}` : "Not deployed"}.</p>
                {deployment?.error ? <p className="text-xs text-muted">{deployment.error}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => apply(deployAgent(ws, agent.id, "local-worker"))}>Arm local worker</button>
                  <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => apply(deployAgent(ws, agent.id, "hosted-worker"))}>Record hosted target</button>
                  <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => togglePin(prev, "agent", agent.id))}>Pin</button>
                  <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => ({ ...prev, agents: prev.agents.map((item) => (item.id === agent.id ? { ...item, archived: true } : item)) }))}>Archive</button>
                </div>
              </li>
            );
          })}
        </ul>
        {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
      </section>
    );
  }

  if (mode === "runs") {
    return (
      <section className="p-4 md:p-6">
        <h2 className="font-display text-3xl font-bold">Agent runs</h2>
        <p className="text-sm text-muted">Events come from the local worker. This does not call a model, send mail, or invent browser screenshots.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <select value={active?.id ?? ""} onChange={(event) => setAgentId(event.target.value)} className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm">
            <option value="">Choose agent</option>
            {ws.agents.filter((agent) => !agent.archived).map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
          <input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="What should this run do?" className="min-h-11 min-w-0 flex-1 rounded-panel border border-line bg-surface px-3 text-sm" />
          <button
            type="button"
            className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
            onClick={() => {
              if (!active) {
                setNote("Add an agent first.");
                return;
              }
              apply(enqueueRun(ws, active.id, goal));
            }}
          >
            Queue run
          </button>
          <button
            type="button"
            className="min-h-11 rounded-panel border border-line px-3 text-sm"
            onClick={() => setWs((prev) => tickFleet(prev, { now: new Date().toISOString(), workerId: "browser-worker" }))}
          >
            Run worker once
          </button>
        </div>
        {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
        <ul className="mt-4 space-y-3">
          {ws.runs.length === 0 && <li className="text-sm text-muted">No runs yet.</li>}
          {ws.runs.slice(0, 20).map((run) => (
            <li key={run.id} className="rounded-panel border border-line bg-surface p-3 text-sm">
              <p className="font-semibold">{ws.agents.find((agent) => agent.id === run.agentId)?.name ?? "Agent"} · {run.state}</p>
              <p className="text-muted">{run.goal}</p>
              {run.plan.length > 0 && <p className="mt-1 text-xs text-muted">Plan: {run.plan.map((step) => step.tool).join(" → ")}. Missing tools wait. They are not marked done.</p>}
              {run.result ? <p className="mt-1 whitespace-pre-wrap">{run.result}</p> : null}
              {run.error ? <p className="mt-1 text-danger">{run.error}</p> : null}
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {ws.runEvents.filter((item) => item.runId === run.id).slice(0, 6).map((item) => (
                  <li key={item.id}>{item.kind}: {item.detail}</li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => pauseRun(prev, run.id))}>Pause</button>
                <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => resumeRun(prev, run.id))}>Resume</button>
                <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => cancelRun(prev, run.id))}>Stop run</button>
                <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => approveRunAction(prev, run.id, "browser"))}>Approve browser</button>
                <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => approveRunAction(prev, run.id, "gmail_send"))}>Approve send</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (mode === "connected") {
    return (
      <section className="p-4 md:p-6">
        <h2 className="font-display text-3xl font-bold">Connected apps</h2>
        <p className="text-sm text-muted">Connection records do not store API keys or OAuth tokens. Gmail stays not connected until Google OAuth is configured.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <select value={provider} onChange={(event) => setProvider(event.target.value as ProviderConnection["provider"])} className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm">
            {["grok", "openai", "anthropic", "gemini", "openrouter", "ollama"].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <input value={connectionLabel} onChange={(event) => setConnectionLabel(event.target.value)} placeholder="Connection name" className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm" />
          <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" onClick={() => apply(addConnection(ws, provider, connectionLabel, false))}>Add connection</button>
        </div>
        <ul className="mt-4 space-y-2">
          {ws.connections.length === 0 && <li className="text-sm text-muted">No extra connections yet. Chat still uses the server Grok key only when you press Send.</li>}
          {ws.connections.map((item) => (
            <li key={item.id} className="rounded-panel border border-line bg-surface p-3 text-sm">
              {item.label} · {item.provider} · {item.status === "server-configured" ? "Server key present. Live call not verified." : "Not configured. It cannot be selected."} · secret stored: no
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          <input value={mailLabel} onChange={(event) => setMailLabel(event.target.value)} placeholder="Mailbox label" className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm" />
          <input value={mailAddress} onChange={(event) => setMailAddress(event.target.value)} placeholder="name@example.com" className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm" />
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => apply(addMailbox(ws, mailLabel, mailAddress))}>Add mailbox record</button>
          <button type="button" className="is-coming-soon min-h-11 rounded-panel border border-line px-3 text-sm" title="Coming soon — Google OAuth is not started from this button" aria-disabled={true} onClick={() => setNote(gmailConnectAttempt().error)}>Connect Google</button>
        </div>
        <ul className="mt-3 space-y-2">
          {ws.mailboxes.map((item) => (
            <li key={item.id} className="text-sm text-muted">{item.label} · {item.address} · {item.status}</li>
          ))}
        </ul>
        {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
      </section>
    );
  }

  if (mode === "scheduled") {
    return (
      <section className="p-4 md:p-6">
        <h2 className="font-display text-3xl font-bold">Scheduled tasks</h2>
        <p className="text-sm text-muted">{workerNote} This database is local. It is not hosted scheduling.</p>
        <p className="mt-2 text-xs text-muted">One pass: node --experimental-strip-types scripts/schedule-tick.mjs. Stay up: node --experimental-strip-types scripts/schedule-worker.mjs. Interval: MIND_WORKER_INTERVAL_MS.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <input value={jobName} onChange={(event) => setJobName(event.target.value)} placeholder="Morning notes" className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm" />
          <input value={jobZone} onChange={(event) => setJobZone(event.target.value)} placeholder="America/Chicago" className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm" />
          <input value={jobHour} onChange={(event) => setJobHour(event.target.value)} placeholder="Hour 0-23, optional" className="min-h-11 w-28 rounded-panel border border-line bg-surface px-3 text-sm" />
          <button
            type="button"
            className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
            onClick={() => {
              const hour = jobHour.trim() === "" ? null : Number(jobHour);
              apply(addSchedule(ws, jobName, active?.id ?? null, 1440, undefined, jobZone || "UTC", hour != null && Number.isFinite(hour) ? hour : null, 0));
            }}
          >
            Add daily job
          </button>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setWs((prev) => runDueSchedules(prev, new Date().toISOString()))}>Run due schedules</button>
        </div>
        <ul className="mt-4 space-y-2">
          {ws.schedules.length === 0 && <li className="text-sm text-muted">No schedules yet.</li>}
          {ws.schedules.map((job) => (
            <li key={job.id} className="rounded-panel border border-line bg-surface p-3 text-sm">
              <p className="font-semibold">{job.name}</p>
              <p className="text-xs text-muted">{job.enabled ? "On" : "Off"} · {job.timeZone || "UTC"}{job.clockHour == null ? ` · every ${job.intervalMinutes} minutes` : ` · ${String(job.clockHour).padStart(2, "0")}:${String(job.clockMinute ?? 0).padStart(2, "0")}`} · next {job.nextRunAt} · last {job.lastRunAt ?? "never"} · {job.lastStatus || "no run"} · {job.lastError || "No error"}</p>
              <button type="button" className="mt-2 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setWs((prev) => setScheduleEnabled(prev, job.id, !job.enabled))}>{job.enabled ? "Turn off" : "Turn on"}</button>
            </li>
          ))}
        </ul>
        {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
      </section>
    );
  }

  return (
    <section className="p-4 md:p-6">
      <h2 className="font-display text-3xl font-bold">Tools</h2>
      <p className="text-sm text-muted">Local reads run in the worker. Page inspect uses the browser driver only when you press Open page. Image, video, and model calls are not made here.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <input value={pageUrl} onChange={(event) => setPageUrl(event.target.value)} placeholder="https://example.com" className="min-h-11 min-w-0 flex-1 rounded-panel border border-line bg-surface px-3 text-sm" />
        <button
          type="button"
          className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
          onClick={() => {
            void inspectWebPage({ data: { url: pageUrl } }).then((result) => {
              setPageNote(result.ok ? `${result.title}\n${result.excerpt}` : result.error);
            }).catch((error: unknown) => {
              setPageNote(error instanceof Error ? error.message : "The page was not opened.");
            });
          }}
        >
          Open page
        </button>
      </div>
      {pageNote ? <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{pageNote}</p> : null}
      <ul className="mt-4 space-y-2 text-sm">
        {toolCatalog().map((tool) => (
          <li key={tool.id} className="rounded-panel border border-line bg-surface p-3">
            <p className="font-semibold">{tool.name} · {tool.available ? "Available" : "Not available"}</p>
            <p className="text-xs text-muted">{tool.reason}</p>
          </li>
        ))}
      </ul>
      <ul className="mt-4 space-y-2 text-sm">
        {ws.browserSessions.map((session) => (
          <li key={session.id} className="rounded-panel border border-line bg-surface p-3">
            <p className="font-semibold">{session.title || "No title"} · {session.status}</p>
            <p className="text-xs text-muted">{session.url}</p>
            <p className="mt-1">{session.excerpt || session.lastAction}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
