import { useEffect, useState } from "react";
import { inspectWebPage, mcpRegistryCall, mcpRegistryList, mcpRegistryToggle, mcpRegistryTools, workerHealth } from "@/lib/mind/server";
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


function botAvatarSrc(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("document") || lower.includes("personal") || lower.includes("content") || lower.includes("knowledge")) return "/avatars/avatar-documents.webp";
  if (lower.includes("research") || lower.includes("data")) return "/avatars/avatar-research.webp";
  if (lower.includes("cod") || lower.includes("build") || lower.includes("browser") || lower.includes("project")) return "/avatars/avatar-build.webp";
  if (lower.includes("notion") || lower.includes("knowledge")) return "/avatars/avatar-notion.webp";
  if (lower.includes("email") || lower.includes("mail")) return "/avatars/avatar-email.webp";
  const pool = [
    "/avatars/avatar-documents.webp",
    "/avatars/avatar-research.webp",
    "/avatars/avatar-build.webp",
    "/avatars/avatar-notion.webp",
    "/avatars/avatar-email.webp",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash + name.charCodeAt(i) * (i + 1)) % pool.length;
  return pool[hash];
}

export function FleetPanel({
  mode,
  ws,
  setWs,
  onFailure,
}: {
  mode: "agents" | "runs" | "connected" | "scheduled" | "tools";
  ws: Workspace;
  setWs: (updater: (prev: Workspace) => Workspace) => void;
  onFailure?: (message: string, retry: () => void) => void;
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
  const [mcpServers, setMcpServers] = useState<{ id: string; label: string; kind: string; enabled: boolean }[]>([]);
  const [mcpTools, setMcpTools] = useState<{ serverId: string; serverLabel: string; name: string; description: string; enabled: boolean; status?: string }[]>([]);
  const [mcpCallNote, setMcpCallNote] = useState<string | null>(null);
  const [mcpCallStatus, setMcpCallStatus] = useState<"idle" | "running" | "ok" | "error" | "timeout">("idle");
  const [pcApprovals, setPcApprovals] = useState<
    { id: string; token: string; command: string; agentId: string; agentLabel: string; expiresAt: string }[]
  >([]);
  const [pcApprovalNote, setPcApprovalNote] = useState<string | null>(null);

  function refreshPcApprovals() {
    void fetch("/api/mind/pc/approvals", { credentials: "include" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | { ok?: boolean; approvals?: typeof pcApprovals }
          | null;
        if (body?.ok && Array.isArray(body.approvals)) setPcApprovals(body.approvals);
        else setPcApprovals([]);
      })
      .catch(() => setPcApprovals([]));
  }

  useEffect(() => {
    if (mode !== "tools") return;
    void mcpRegistryList()
      .then((result) => setMcpServers(result.servers))
      .catch(() => setMcpServers([]));
    void mcpRegistryTools()
      .then((result) => setMcpTools(result.tools))
      .catch(() => setMcpTools([]));
    refreshPcApprovals();
    const timer = window.setInterval(refreshPcApprovals, 15_000);
    return () => window.clearInterval(timer);
  }, [mode]);
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

  useEffect(() => {
    if (mode !== "tools") return;
    void mcpRegistryList()
      .then((result) => setMcpServers(result.servers))
      .catch(() => setMcpServers([]));
    void mcpRegistryTools()
      .then((result) => setMcpTools(result.tools))
      .catch(() => setMcpTools([]));
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
      <section className="dense-card card-texture mx-4 mb-6 p-4 md:mx-6">
        <h3 className="font-semibold">Agent directory</h3>
        <p className="mt-1 text-sm text-muted">Templates are definitions. A saved agent is not deployed. Local ready means the Run worker button in this app can execute it. Hosted stays external until a worker process exists.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {AGENT_TEMPLATES.map((template) => (
            <button key={template.name} type="button" className="dense-card inline-flex min-h-11 items-center gap-2 px-3 text-sm" onClick={() => apply(addAgentFromTemplate(ws, template.name))}>
              <img src={botAvatarSrc(template.name)} alt="" className="bot-avatar-img size-8" />
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
              <li key={agent.id} className="glow-card rounded-panel border border-line/80 p-3 text-sm">
                <div className="flex items-start gap-3">
                  <img src={botAvatarSrc(agent.name)} alt="" className="bot-avatar-img" />
                  <div className="min-w-0 flex-1">
                <p className="font-semibold">{agent.name}</p>
                <p className="text-muted">{agent.description}</p>
                <p className="mt-1 text-xs text-muted">Tools: {agent.tools.join(", ") || "none"}. Version {agent.version}. {deployment ? `${deployment.target} · ${deployment.state}` : "Not deployed"}.</p>
                {deployment?.error ? <p className="text-xs text-muted">{deployment.error}</p> : null}
                  </div>
                </div>
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
      <section className="page-shell">
        <div className="page-hero mb-4">
        <h2 className="font-display text-3xl font-bold">Agent runs</h2>
        <p className="text-sm text-muted">Events come from the local worker. This does not call a model, send mail, or invent browser screenshots.</p>
        </div>
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
          {ws.runs.length === 0 && (
            <li className="empty-state">
              <img src="/empty/empty-activity.svg" alt="" />
              <p className="font-semibold">No runs yet</p>
              <p className="text-sm text-muted">Queue a run, then press Run worker once.</p>
            </li>
          )}
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
      <section className="page-shell">
        <div className="page-hero mb-4">
          <h2 className="font-display text-3xl font-bold">Connected apps</h2>
          <p className="text-sm text-muted">Connection records do not store API keys or OAuth tokens. Gmail stays not connected until Google OAuth is configured.</p>
        </div>
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
            <li key={item.id} className="dense-card dense-row text-sm">
              {item.label} · {item.provider} · {item.status === "server-configured" ? "Server key present. Live call not verified." : "Not configured. It cannot be selected."} · secret stored: no
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          <input value={mailLabel} onChange={(event) => setMailLabel(event.target.value)} placeholder="Mailbox label" className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm" />
          <input value={mailAddress} onChange={(event) => setMailAddress(event.target.value)} placeholder="name@example.com" className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm" />
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => apply(addMailbox(ws, mailLabel, mailAddress))}>Add mailbox record</button>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setNote(gmailConnectAttempt().error)}>Connect Google</button>
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
      <section className="page-shell">
        <div className="page-hero mb-4"><h2 className="font-display text-3xl font-bold">Scheduled tasks</h2><p className="text-sm text-muted">{workerNote} This database is local. It is not hosted scheduling.</p></div>
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
          {ws.schedules.length === 0 && (
            <li className="empty-state">
              <img src="/empty/empty-activity.svg" alt="" />
              <p className="font-semibold">No schedules yet</p>
              <p className="text-sm text-muted">Add a daily job to queue local work.</p>
            </li>
          )}
          {ws.schedules.map((job) => (
            <li key={job.id} className="dense-card p-3 text-sm">
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
    <section className="page-shell">
      <div className="page-hero mb-4">
        <h2 className="font-display text-3xl font-bold">Tools</h2>
        <p className="text-sm text-muted">Local reads run in the worker. Page inspect uses the browser driver only when you press Open page. Image, video, and model calls are not made here.</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <input value={pageUrl} onChange={(event) => setPageUrl(event.target.value)} placeholder="https://example.com" className="min-h-11 min-w-0 flex-1 rounded-panel border border-line bg-surface px-3 text-sm" />
        <button
          type="button"
          className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
          onClick={() => {
            const run = () => {
              void inspectWebPage({ data: { url: pageUrl } }).then((result) => {
                if (result.ok) {
                  setPageNote(`${result.title}\n${result.excerpt}`);
                  return;
                }
                setPageNote(result.error);
                onFailure?.(result.error, run);
              }).catch((error: unknown) => {
                const message = error instanceof Error ? error.message : "The page was not opened.";
                setPageNote(message);
                onFailure?.(message, run);
              });
            };
            run();
          }}
        >
          Open page
        </button>
      </div>
      {pageNote ? <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{pageNote}</p> : null}
      <ul className="mt-4 space-y-2 text-sm">
        {toolCatalog().map((tool) => (
          <li key={tool.id} className="dense-card flex flex-col gap-1 p-3">
            <p className="font-semibold">{tool.name} · {tool.available ? "Available" : "Not available"}</p>
            <p className="text-xs text-muted">{tool.reason}</p>
          </li>
        ))}
      </ul>

      <div className="mt-6 space-y-3">
        <h3 className="font-semibold">PC shell approvals</h3>
        <p className="text-sm text-muted">Non-allowlisted pc_run_shell commands wait here. Approve or deny from this panel only — tool confirm args cannot authorize them.</p>
        <ul className="space-y-2 text-sm">
          {pcApprovals.map((item) => (
            <li key={item.id} className="rounded-panel border border-line bg-surface p-3">
              <p className="font-semibold">{item.command}</p>
              <p className="text-xs text-muted">Agent {item.agentLabel || item.agentId} · expires {item.expiresAt} · id {item.id}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-line px-3 text-sm"
                  onClick={() => {
                    setPcApprovalNote(`approving ${item.id}`);
                    void fetch("/api/mind/pc/approve", {
                      method: "POST",
                      credentials: "include",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ approvalId: item.id, token: item.token, command: item.command }),
                    })
                      .then(async (res) => {
                        const body = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null;
                        setPcApprovalNote(body?.ok ? `ok: ${body.text ?? "ran"}` : `error: ${body?.error ?? res.status}`);
                        refreshPcApprovals();
                      })
                      .catch((error: unknown) => {
                        setPcApprovalNote(error instanceof Error ? error.message : "Approve failed.");
                      });
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-line px-3 text-sm"
                  onClick={() => {
                    setPcApprovalNote(`denying ${item.id}`);
                    void fetch("/api/mind/pc/deny", {
                      method: "POST",
                      credentials: "include",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ approvalId: item.id, token: item.token }),
                    })
                      .then(async (res) => {
                        const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
                        setPcApprovalNote(body?.ok ? `denied ${item.id}` : `error: ${body?.error ?? res.status}`);
                        refreshPcApprovals();
                      })
                      .catch((error: unknown) => {
                        setPcApprovalNote(error instanceof Error ? error.message : "Deny failed.");
                      });
                  }}
                >
                  Deny
                </button>
              </div>
            </li>
          ))}
          {pcApprovals.length === 0 ? <li className="text-sm text-muted">No pending PC shell approvals.</li> : null}
        </ul>
        {pcApprovalNote ? <p className="whitespace-pre-wrap text-sm text-muted">{pcApprovalNote}</p> : null}
      </div>

      <div className="mt-6 space-y-3">
        <h3 className="font-semibold">MCP servers</h3>
        <p className="text-sm text-muted">Every registered server is listed. Disabled servers keep their tools visible but calls refuse honestly. Toggles persist on the server.</p>
        <ul className="space-y-2 text-sm">
          {mcpServers.map((server) => {
            const tools = mcpTools.filter((tool) => tool.serverId === server.id);
            return (
              <li key={server.id} className="rounded-panel border border-line bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{server.label}</p>
                    <p className="text-xs text-muted">{server.kind} · {server.enabled ? "Enabled" : "Disabled"} · {tools.filter((t) => !t.name.startsWith("(")).length} tool(s)</p>
                  </div>
                  <button
                    type="button"
                    className="min-h-11 rounded-panel border border-line px-3 text-sm"
                    onClick={() => {
                      void mcpRegistryToggle({ data: { id: server.id, enabled: !server.enabled } }).then((result) => {
                        setMcpServers(result.servers);
                        void mcpRegistryTools().then((listed) => setMcpTools(listed.tools)).catch(() => undefined);
                      });
                    }}
                  >
                    {server.enabled ? "Turn off" : "Turn on"}
                  </button>
                </div>
                <ul className="mt-2 space-y-1">
                  {tools.map((tool) => (
                    <li key={`${tool.serverId}:${tool.name}`} className="rounded-panel border border-line px-2 py-1">
                      <p className="font-semibold">{tool.name} · {tool.status === "timeout" ? "Timed out" : tool.status === "error" ? "Error" : server.enabled && tool.enabled ? "Available" : "Gated"}</p>
                      <p className="text-xs text-muted">{tool.description}</p>
                      {tool.name === "pglite_query" ? (
                        <button
                          type="button"
                          className="mt-1 min-h-11 rounded-panel border border-line px-3 text-sm"
                          disabled={mcpCallStatus === "running"}
                          onClick={() => {
                            setMcpCallStatus("running");
                            setMcpCallNote(`running: pglite_query on ${server.label} (enabled=${server.enabled})`);
                            void mcpRegistryCall({ data: { serverId: server.id, tool: "pglite_query", args: { sql: "SELECT 1 AS n" } } })
                              .then((result) => {
                                const row = result as { status: string; text: string };
                                setMcpCallStatus(row.status === "ok" ? "ok" : row.status === "timeout" ? "timeout" : "error");
                                setMcpCallNote(`${row.status}: ${row.text}`);
                              })
                              .catch((error: unknown) => {
                                setMcpCallStatus("error");
                                setMcpCallNote(error instanceof Error ? error.message : "MCP call failed.");
                              });
                          }}
                        >
                          Try SELECT 1
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
          {mcpServers.length === 0 && <li className="text-sm text-muted">No MCP servers loaded yet.</li>}
        </ul>
        {mcpCallNote ? <p className="whitespace-pre-wrap text-sm text-muted">Tool result ({mcpCallStatus}): {mcpCallNote}</p> : null}
      </div>

      <ul className="mt-4 space-y-2 text-sm">
        {ws.browserSessions.length === 0 && <li className="rounded-panel border border-line bg-surface p-3 text-muted">No browser sessions yet. Open page records one only after a successful inspect.</li>}
        {ws.browserSessions.map((session) => (
          <li key={session.id} className="dense-card p-3">
            <p className="font-semibold">{session.title || "No title"} · {session.status}</p>
            <p className="text-xs text-muted">{session.url}</p>
            <p className="mt-1">{session.excerpt || session.lastAction}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
