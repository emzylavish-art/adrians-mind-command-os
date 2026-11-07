import { useEffect, useRef, useState } from "react";
import { inspectWebPage, mcpRegistryCall, mcpRegistryList, mcpRegistryToggle, mcpRegistryTools, mindStatus, workerHealth } from "@/lib/mind/server";
import { oauthBoardState } from "@/lib/mind/connection-board";
import { fetchOauthStatusPayload } from "@/lib/mind/service-board-status";
import { LOGIC_ROUTES, logicMenuState, type LogicRoutePublic } from "@/lib/mind/logic-routes";
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
import {
  MCP_LIST_LOAD_TIMEOUT_MS,
  McpListStatusRows,
  McpToolsListStatusRows,
  PcApprovalsListStatusRows,
  WorkerHealthStatusRows,
  isCurrentListGeneration,
  isListAuthRequiredNotice,
  loadMcpList,
  loadMcpToolsList,
  loadPcApprovalsList,
  loadWorkerHealthStatus,
  nextListGeneration,
  onceListRetry,
  type FleetListState,
  type McpListState,
  type McpToolRow,
  type PcApprovalRow,
  type WorkerHealthState,
} from "@/lib/mind/mcp-list-state";
import {
  PcApprovalActionStatusRows,
  onceRetry,
  runPcApprovalAction,
  snapshotPcApprovalActionParams,
  type PcApprovalActionState,
} from "@/lib/mind/pc-approval-action";
import {
  McpCallActionStatusRows,
  onceRetry as onceMcpCallRetry,
  runMcpTrySelect,
  snapshotMcpTrySelectParams,
  type McpCallActionState,
} from "@/lib/mind/mcp-call-action";
import { CustomConnections } from "@/components/mind/custom-connections";
import {
  OpenPageActionStatusRows,
  onceRetry as onceOpenPageRetry,
  runOpenPage,
  snapshotOpenPageParams,
  type OpenPageActionState,
} from "@/lib/mind/open-page-action";
import {
  McpToggleActionStatusRows,
  onceRetry as onceMcpToggleRetry,
  runMcpToggle,
  snapshotMcpToggleParams,
  type McpToggleActionState,
} from "@/lib/mind/mcp-toggle-action";
import {
  FleetMutationFailureBanner,
  onceRetry as onceFleetMutationRetry,
  runFleetMutation,
  snapshotFleetMutationParams,
  type FleetMutationActionState,
  type FleetMutationParams,
  type FleetMutationResult,
} from "@/lib/mind/fleet-mutation-action";

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
  logicRoutes = [],
  providerChoice,
  onSelectProvider,
}: {
  mode: "agents" | "runs" | "connected" | "scheduled" | "tools";
  ws: Workspace;
  setWs: (updater: (prev: Workspace) => Workspace) => void;
  onFailure?: (message: string, retry: () => void, surface?: "mcp" | "browser") => void;
  logicRoutes?: LogicRoutePublic[];
  providerChoice?: string;
  onSelectProvider?: (id: string) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [mutationState, setMutationState] = useState<FleetMutationActionState>({ status: "idle" });
  const [goal, setGoal] = useState("");
  const [agentId, setAgentId] = useState("");
  const [mailLabel, setMailLabel] = useState("");
  const [mailAddress, setMailAddress] = useState("");
  const [connectionLabel, setConnectionLabel] = useState("");
  const [provider, setProvider] = useState<string>(providerChoice ?? "openai");
  const [gmailBoard, setGmailBoard] = useState<{ state: string; detail: string }>({ state: "Checking", detail: "Checking connection…" });
  const [jobName, setJobName] = useState("");
  const [jobZone, setJobZone] = useState("America/Chicago");
  const [jobHour, setJobHour] = useState("");
  const [workerHealthState, setWorkerHealthState] = useState<WorkerHealthState>({ status: "loading" });
  const workerHealthInFlight = useRef(false);
  const workerHealthGeneration = useRef(0);
  const [pageUrl, setPageUrl] = useState("");
  const [pageNote, setPageNote] = useState<string | null>(null);
  const [openPageActionState, setOpenPageActionState] = useState<OpenPageActionState>({ status: "idle" });
  const [mcpToggleActionState, setMcpToggleActionState] = useState<McpToggleActionState>({ status: "idle" });
  const [mcpServers, setMcpServers] = useState<{ id: string; label: string; kind: string; enabled: boolean }[]>([]);
  const [mcpListState, setMcpListState] = useState<McpListState>({ status: "loading" });
  const mcpListInFlight = useRef(false);
  const mcpListGeneration = useRef(0);
  const [mcpTools, setMcpTools] = useState<McpToolRow[]>([]);
  const [mcpToolsState, setMcpToolsState] = useState<FleetListState<McpToolRow>>({ status: "loading" });
  const mcpToolsInFlight = useRef(false);
  const mcpToolsGeneration = useRef(0);
  const [mcpCallNote, setMcpCallNote] = useState<string | null>(null);
  const [mcpCallStatus, setMcpCallStatus] = useState<"idle" | "running" | "ok" | "error" | "timeout">("idle");
  const [mcpCallActionState, setMcpCallActionState] = useState<McpCallActionState>({ status: "idle" });
  const [pcApprovals, setPcApprovals] = useState<PcApprovalRow[]>([]);
  const [pcApprovalsState, setPcApprovalsState] = useState<FleetListState<PcApprovalRow>>({ status: "loading" });
  const pcApprovalsInFlight = useRef(false);
  const pcApprovalsGeneration = useRef(0);
  const [pcApprovalNote, setPcApprovalNote] = useState<string | null>(null);
  const [pcApprovalActionState, setPcApprovalActionState] = useState<PcApprovalActionState>({ status: "idle" });

  /** One MCP server list load: loading → ready (maybe empty) or error banner. Timeout + stale guard. */
  function loadMcpServers() {
    if (mcpListInFlight.current) return;
    mcpListInFlight.current = true;
    const generation = nextListGeneration(mcpListGeneration.current);
    mcpListGeneration.current = generation;
    setMcpListState({ status: "loading" });
    void loadMcpList(() => mcpRegistryList(), { timeoutMs: MCP_LIST_LOAD_TIMEOUT_MS })
      .then((next) => {
        if (!isCurrentListGeneration(generation, mcpListGeneration.current)) return;
        setMcpListState(next);
        if (next.status === "ready") {
          setMcpServers(next.servers);
          return;
        }
        setMcpServers([]);
        // auth_required → local dismissible notice in McpListStatusRows; do not escalate to top red banner / Retry storm.
        if (next.status === "error" && !isListAuthRequiredNotice(next.kind)) {
          onFailure?.(next.message, onceListRetry(loadMcpServers), "mcp");
        }
      })
      .finally(() => {
        if (generation === mcpListGeneration.current) mcpListInFlight.current = false;
      });
  }

  /** One MCP tools list load — never swallows failures as []. */
  function loadMcpTools() {
    if (mcpToolsInFlight.current) return;
    mcpToolsInFlight.current = true;
    const generation = nextListGeneration(mcpToolsGeneration.current);
    mcpToolsGeneration.current = generation;
    setMcpToolsState({ status: "loading" });
    void loadMcpToolsList(() => mcpRegistryTools(), { timeoutMs: MCP_LIST_LOAD_TIMEOUT_MS })
      .then((next) => {
        if (!isCurrentListGeneration(generation, mcpToolsGeneration.current)) return;
        setMcpToolsState(next);
        if (next.status === "ready") {
          setMcpTools(next.items);
          return;
        }
        setMcpTools([]);
        if (next.status === "error" && !isListAuthRequiredNotice(next.kind)) {
          onFailure?.(next.message, onceListRetry(loadMcpTools), "mcp");
        }
      })
      .finally(() => {
        if (generation === mcpToolsGeneration.current) mcpToolsInFlight.current = false;
      });
  }

  /** One PC approvals list load — failed fetch must not look like "nothing pending". */
  function refreshPcApprovals() {
    if (pcApprovalsInFlight.current) return;
    pcApprovalsInFlight.current = true;
    const generation = nextListGeneration(pcApprovalsGeneration.current);
    pcApprovalsGeneration.current = generation;
    setPcApprovalsState({ status: "loading" });
    void loadPcApprovalsList(async () => {
      const res = await fetch("/api/mind/pc/approvals", { credentials: "include" });
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      }
      return res.json();
    }, { timeoutMs: MCP_LIST_LOAD_TIMEOUT_MS })
      .then((next) => {
        if (!isCurrentListGeneration(generation, pcApprovalsGeneration.current)) return;
        setPcApprovalsState(next);
        if (next.status === "ready") {
          setPcApprovals(next.items);
          return;
        }
        setPcApprovals([]);
        if (next.status === "error" && !isListAuthRequiredNotice(next.kind)) {
          onFailure?.(next.message, onceListRetry(refreshPcApprovals));
        }
      })
      .finally(() => {
        if (generation === pcApprovalsGeneration.current) pcApprovalsInFlight.current = false;
      });
  }

  useEffect(() => {
    if (mode !== "tools") return;
    loadMcpServers();
    loadMcpTools();
    refreshPcApprovals();
    const timer = window.setInterval(refreshPcApprovals, 15_000);
    return () => {
      window.clearInterval(timer);
      // Invalidate in-flight responses when leaving tools mode.
      mcpListGeneration.current = nextListGeneration(mcpListGeneration.current);
      mcpToolsGeneration.current = nextListGeneration(mcpToolsGeneration.current);
      pcApprovalsGeneration.current = nextListGeneration(pcApprovalsGeneration.current);
      mcpListInFlight.current = false;
      mcpToolsInFlight.current = false;
      pcApprovalsInFlight.current = false;
    };
  }, [mode]);
  const [customName, setCustomName] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [customTools, setCustomTools] = useState<FleetTool[]>(["list_projects"]);
  const active = ws.agents.find((agent) => agent.id === agentId && !agent.archived) ?? ws.agents.find((agent) => !agent.archived) ?? null;

  /** One workerHealth probe: loading → ready (offline/local detail) or error banner. Timeout + stale guard. */
  function loadWorkerHealth() {
    if (workerHealthInFlight.current) return;
    workerHealthInFlight.current = true;
    const generation = nextListGeneration(workerHealthGeneration.current);
    workerHealthGeneration.current = generation;
    setWorkerHealthState({ status: "loading" });
    void loadWorkerHealthStatus(() => workerHealth(), { timeoutMs: MCP_LIST_LOAD_TIMEOUT_MS })
      .then((next) => {
        if (!isCurrentListGeneration(generation, workerHealthGeneration.current)) return;
        setWorkerHealthState(next);
        if (next.status === "error" && !isListAuthRequiredNotice(next.kind)) {
          onFailure?.(next.message, onceListRetry(loadWorkerHealth));
        }
      })
      .finally(() => {
        if (generation === workerHealthGeneration.current) workerHealthInFlight.current = false;
      });
  }

  useEffect(() => {
    if (mode !== "connected") return;
    let cancel = false;
    void fetchOauthStatusPayload("/api/mind/oauth/gmail/status").then((status) => {
      if (!cancel) setGmailBoard(oauthBoardState(status));
    });
    return () => {
      cancel = true;
    };
  }, [mode]);

  // After sign-in, refetch MCP list so servers appear without a full reload (one quiet notice).
  useEffect(() => {
    if (mode !== "tools") return;
    if (mcpListState.status !== "unauthenticated") return;
    const refetchIfSignedIn = () => {
      void mindStatus()
        .then((status) => {
          if (status.signedIn === true) loadMcpServers();
        })
        .catch(() => undefined);
    };
    const onFocus = () => refetchIfSignedIn();
    const onVis = () => {
      if (document.visibilityState === "visible") refetchIfSignedIn();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    const poll = window.setInterval(refetchIfSignedIn, 4_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(poll);
    };
  }, [mode, mcpListState.status]);

  useEffect(() => {
    if (mode !== "scheduled") return;
    loadWorkerHealth();
    return () => {
      workerHealthGeneration.current = nextListGeneration(workerHealthGeneration.current);
      workerHealthInFlight.current = false;
    };
  }, [mode]);


  function executeFleetMutation(current: Workspace, params: FleetMutationParams): FleetMutationResult {
    switch (params.kind) {
      case "add_template":
        return addAgentFromTemplate(current, params.templateName);
      case "add_custom":
        return addCustomAgent(current, {
          name: params.name,
          instructions: params.instructions,
          tools: params.tools,
        });
      case "deploy":
        return deployAgent(current, params.agentId, params.target);
      case "enqueue":
        return enqueueRun(current, params.agentId, params.goal);
      case "enqueue_no_agent":
        return { ok: false, error: "Add an agent first." };
      case "add_connection":
        return addConnection(current, params.provider, params.label, false);
      case "add_mailbox":
        return addMailbox(current, params.label, params.address);
      case "add_schedule":
        return addSchedule(
          current,
          params.name,
          params.agentId,
          params.intervalMinutes,
          undefined,
          params.timeZone,
          params.clockHour,
          params.clockMinute,
        );
    }
  }

  function runMutation(params: FleetMutationParams) {
    const result = runFleetMutation(params, (snap) => executeFleetMutation(ws, snap));
    if (!result.ok) {
      setMutationState({
        status: "error",
        kind: result.kind,
        message: result.message,
        params: result.params,
      });
      setNote(null);
      const retry = onceFleetMutationRetry(() => runMutation(result.params));
      if (retry) onFailure?.(result.message, retry);
      return;
    }
    setMutationState({ status: "idle" });
    setWs(() => result.ws);
    setNote(null);
  }

  function mutationBanner() {
    return (
      <FleetMutationFailureBanner
        state={mutationState}
        onRetry={
          mutationState.status === "error"
            ? onceFleetMutationRetry(() => runMutation(mutationState.params)) ?? (() => undefined)
            : () => undefined
        }
      />
    );
  }

  if (mode === "agents") {
    return (
      <section className="dense-card card-texture mx-4 mb-6 p-4 md:mx-6">
        <h3 className="font-semibold">Agent directory</h3>
        <p className="mt-1 text-sm text-muted">Templates are definitions. A saved agent is not deployed. Local ready means the Run worker button in this app can execute it. Hosted stays external until a worker process exists.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {AGENT_TEMPLATES.map((template) => (
            <button key={template.name} type="button" className="dense-card inline-flex min-h-11 items-center gap-2 px-3 text-sm" onClick={() => runMutation(snapshotFleetMutationParams({ kind: "add_template", templateName: template.name }))}>
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
            onClick={() => runMutation(snapshotFleetMutationParams({ kind: "add_custom", name: customName, instructions: customInstructions, tools: customTools }))}
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
                {deployment?.error ? <p className="text-xs text-danger" role="status">{deployment.error}</p> : null}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => runMutation(snapshotFleetMutationParams({ kind: "deploy", agentId: agent.id, target: "local-worker" }))}>Arm local worker</button>
                  <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => runMutation(snapshotFleetMutationParams({ kind: "deploy", agentId: agent.id, target: "hosted-worker" }))}>Record hosted target</button>
                  <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => togglePin(prev, "agent", agent.id))}>Pin</button>
                  <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => ({ ...prev, agents: prev.agents.map((item) => (item.id === agent.id ? { ...item, archived: true } : item)) }))}>Archive</button>
                </div>
              </li>
            );
          })}
        </ul>
        {mutationBanner()}
        {note && mutationState.status !== "error" ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
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
          <select aria-label="Choose agent" value={active?.id ?? ""} onChange={(event) => setAgentId(event.target.value)} className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm">
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
                runMutation(snapshotFleetMutationParams({ kind: "enqueue_no_agent", goal }));
                return;
              }
              runMutation(snapshotFleetMutationParams({ kind: "enqueue", agentId: active.id, goal }));
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
        {mutationBanner()}
        {note && mutationState.status !== "error" ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
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
          <select
            aria-label="Connection provider"
            value={provider}
            onChange={(event) => {
              const next = event.target.value;
              setProvider(next);
              onSelectProvider?.(next);
            }}
            className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm"
          >
            {["grok", "openai", "anthropic", "gemini", "openrouter", "ollama", ...LOGIC_ROUTES].map((item) => {
              const route = logicRoutes.find((row) => row.id === item);
              const menu = route ? logicMenuState(route, route.id) : null;
              return (
                <option key={item} value={item} disabled={menu ? !menu.selectable : false}>
                  {menu ? `${menu.label} · ${route?.state}` : item}
                </option>
              );
            })}
          </select>
          <input value={connectionLabel} onChange={(event) => setConnectionLabel(event.target.value)} placeholder="Connection name" className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm" />
          <button
            type="button"
            className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
            onClick={() => {
              const stored = provider === "grok" || provider === "openai" || provider === "anthropic" || provider === "gemini" || provider === "openrouter" || provider === "ollama" ? provider : null;
              if (stored) runMutation(snapshotFleetMutationParams({ kind: "add_connection", provider: stored, label: connectionLabel }));
              else {
                onSelectProvider?.(provider);
                setNote("That route is selected for chat. It is not stored as an API key.");
              }
            }}
          >
            Add connection
          </button>
        </div>
        <ul className="mt-4 space-y-2">
          {ws.connections.length === 0 && <li className="text-sm text-muted">No extra connections yet. Chat still uses the server Grok key only when you press Send.</li>}
          {ws.connections.map((item) => (
            <li key={item.id} className="dense-card dense-row text-sm">
              {item.label} · {item.provider} · {logicRoutes.find((row) => row.id === (item.provider as string))?.reason ?? (item.status === "server-configured" ? "Server key present. Live call not verified." : "Not configured. It cannot be selected.")} · secret stored: no
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          <input value={mailLabel} onChange={(event) => setMailLabel(event.target.value)} placeholder="Mailbox label" className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm" />
          <input value={mailAddress} onChange={(event) => setMailAddress(event.target.value)} placeholder="name@example.com" className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm" />
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => runMutation(snapshotFleetMutationParams({ kind: "add_mailbox", label: mailLabel, address: mailAddress }))}>Add mailbox record</button>
          <button type="button" className="is-coming-soon min-h-11 rounded-panel border border-line px-3 text-sm" title="Coming soon — Google OAuth is not started from this button" aria-disabled={true} onClick={() => setNote(gmailConnectAttempt().error)}>Connect Google</button>
        </div>
        <p className="mt-4 text-sm" data-testid="gmail-oauth-status">Gmail OAuth: {gmailBoard.state}. {gmailBoard.detail}</p>
        <ul className="mt-3 space-y-2">
          {ws.mailboxes.map((item) => (
            <li key={item.id} className="text-sm text-muted">{item.label} · {item.address} · local record {item.status}. This is not the OAuth session.</li>
          ))}
        </ul>
        {mutationBanner()}
        {note && mutationState.status !== "error" ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
      </section>
    );
  }

  if (mode === "scheduled") {
    const workerDetail =
      workerHealthState.status === "ready"
        ? workerHealthState.health.detail
        : workerHealthState.status === "loading"
          ? "Checking the worker."
          : null;
    return (
      <section className="page-shell">
        <div className="page-hero mb-4"><h2 className="font-display text-3xl font-bold">Scheduled tasks</h2><p className="text-sm text-muted">{workerDetail ? `${workerDetail} ` : ""}This database is local. It is not hosted scheduling.</p></div>
        <ul className="mb-2 space-y-2">
          <WorkerHealthStatusRows state={workerHealthState} onRetry={onceListRetry(loadWorkerHealth)} />
        </ul>
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
              runMutation(snapshotFleetMutationParams({
                kind: "add_schedule",
                name: jobName,
                agentId: active?.id ?? null,
                intervalMinutes: 1440,
                timeZone: jobZone || "UTC",
                clockHour: hour != null && Number.isFinite(hour) ? hour : null,
                clockMinute: 0,
              }));
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
        {mutationBanner()}
        {note && mutationState.status !== "error" ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
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
            const params = snapshotOpenPageParams(pageUrl);
            const run = () => {
              setOpenPageActionState({ status: "running", url: params.url });
              void runOpenPage(params, inspectWebPage).then((result) => {
                if (result.ok) {
                  setOpenPageActionState({ status: "ok", note: result.note });
                  setPageNote(result.note);
                  return;
                }
                setOpenPageActionState({
                  status: "error",
                  kind: result.kind,
                  message: result.message,
                  params: result.params,
                });
                setPageNote(null);
                const retry = onceOpenPageRetry(() => run());
                if (retry) onFailure?.(result.message, retry);
              });
            };
            run();
          }}
        >
          Open page
        </button>
      </div>
      <OpenPageActionStatusRows
        state={openPageActionState}
        onRetry={
          openPageActionState.status === "error"
            ? onceOpenPageRetry(() => {
                const params = openPageActionState.params;
                const run = () => {
                  setOpenPageActionState({ status: "running", url: params.url });
                  void runOpenPage(params, inspectWebPage).then((result) => {
                    if (result.ok) {
                      setOpenPageActionState({ status: "ok", note: result.note });
                      setPageNote(result.note);
                      return;
                    }
                    setOpenPageActionState({
                      status: "error",
                      kind: result.kind,
                      message: result.message,
                      params: result.params,
                    });
                    setPageNote(null);
                    const retry = onceOpenPageRetry(() => run());
                    if (retry) onFailure?.(result.message, retry);
                  });
                };
                run();
              }) ?? (() => undefined)
            : () => undefined
        }
      />
      {pageNote && openPageActionState.status !== "error" ? (
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{pageNote}</p>
      ) : null}
      <ul className="tool-list mt-4 space-y-2 text-sm">
        {toolCatalog().map((tool) => (
          <li key={tool.id} className="tool-card dense-card flex flex-col gap-1 p-3" data-available={tool.available ? "true" : "false"}>
            <p className="font-semibold">{tool.name} · {tool.available ? "Available" : "Not available"}</p>
            <p className="text-xs text-muted">{tool.reason}</p>
          </li>
        ))}
      </ul>

      <div className="mt-6 space-y-3">
        <h3 className="font-semibold">PC shell approvals</h3>
        <p className="text-sm text-muted">Non-allowlisted pc_run_shell commands wait here. Approve or deny from this panel only — tool confirm args cannot authorize them.</p>
        <ul className="space-y-2 text-sm">
          {pcApprovalsState.status === "ready"
            ? pcApprovals.map((item) => (
            <li key={item.id} className="rounded-panel border border-line bg-surface p-3">
              <p className="font-semibold">{item.command}</p>
              <p className="text-xs text-muted">Agent {item.agentLabel || item.agentId} · expires {item.expiresAt} · id {item.id}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-line px-3 text-sm"
                  onClick={() => {
                    const params = snapshotPcApprovalActionParams({
                      action: "approve",
                      approvalId: item.id,
                      token: item.token,
                      command: item.command,
                    });
                    const run = () => {
                      setPcApprovalActionState({ status: "running", action: "approve", approvalId: item.id });
                      setPcApprovalNote(`approving ${item.id}`);
                      void runPcApprovalAction(params, fetch).then((result) => {
                        if (result.ok) {
                          setPcApprovalActionState({ status: "ok", note: result.note });
                          setPcApprovalNote(result.note);
                          refreshPcApprovals();
                          return;
                        }
                        setPcApprovalActionState({
                          status: "error",
                          kind: result.kind,
                          message: result.message,
                          params: result.params,
                        });
                        setPcApprovalNote(null);
                        const retry = onceRetry(() => run());
                        if (retry) onFailure?.(result.message, retry);
                      });
                    };
                    run();
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-line px-3 text-sm"
                  onClick={() => {
                    const params = snapshotPcApprovalActionParams({
                      action: "deny",
                      approvalId: item.id,
                      token: item.token,
                    });
                    const run = () => {
                      setPcApprovalActionState({ status: "running", action: "deny", approvalId: item.id });
                      setPcApprovalNote(`denying ${item.id}`);
                      void runPcApprovalAction(params, fetch).then((result) => {
                        if (result.ok) {
                          setPcApprovalActionState({ status: "ok", note: result.note });
                          setPcApprovalNote(result.note);
                          refreshPcApprovals();
                          return;
                        }
                        setPcApprovalActionState({
                          status: "error",
                          kind: result.kind,
                          message: result.message,
                          params: result.params,
                        });
                        setPcApprovalNote(null);
                        const retry = onceRetry(() => run());
                        if (retry) onFailure?.(result.message, retry);
                      });
                    };
                    run();
                  }}
                >
                  Deny
                </button>
              </div>
            </li>
              ))
            : null}
          <PcApprovalsListStatusRows state={pcApprovalsState} onRetry={onceListRetry(refreshPcApprovals)} />
        </ul>
        <PcApprovalActionStatusRows
          state={pcApprovalActionState}
          onRetry={
            pcApprovalActionState.status === "error"
              ? onceRetry(() => {
                  const params = pcApprovalActionState.params;
                  const run = () => {
                    setPcApprovalActionState({ status: "running", action: params.action, approvalId: params.approvalId });
                    void runPcApprovalAction(params, fetch).then((result) => {
                      if (result.ok) {
                        setPcApprovalActionState({ status: "ok", note: result.note });
                        setPcApprovalNote(result.note);
                        refreshPcApprovals();
                        return;
                      }
                      setPcApprovalActionState({
                        status: "error",
                        kind: result.kind,
                        message: result.message,
                        params: result.params,
                      });
                      setPcApprovalNote(null);
                      const retry = onceRetry(() => run());
                      if (retry) onFailure?.(result.message, retry);
                    });
                  };
                  run();
                }) ?? (() => undefined)
              : () => undefined
          }
        />
        {pcApprovalNote && pcApprovalActionState.status !== "error" ? <p className="whitespace-pre-wrap text-sm text-muted">{pcApprovalNote}</p> : null}
      </div>

      <div className="mt-6 space-y-3">
        <h3 className="font-semibold">MCP servers</h3>
        <p className="text-sm text-muted">Every registered server is listed. Disabled servers keep their tools visible but calls refuse honestly. Toggles persist on the server.</p>
        <ul className="space-y-2 text-sm">
          {mcpListState.status === "ready" ? mcpServers.map((server) => {
            const tools = mcpToolsState.status === "ready" ? mcpTools.filter((tool) => tool.serverId === server.id) : [];
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
                      const params = snapshotMcpToggleParams({
                        id: server.id,
                        enabled: !server.enabled,
                        label: server.label,
                      });
                      const run = () => {
                        setMcpToggleActionState({ status: "running", params });
                        void runMcpToggle(params, mcpRegistryToggle).then((result) => {
                          if (result.ok) {
                            setMcpToggleActionState({ status: "ok", note: result.note });
                            setMcpServers(result.servers);
                            loadMcpTools();
                            return;
                          }
                          setMcpToggleActionState({
                            status: "error",
                            kind: result.kind,
                            message: result.message,
                            params: result.params,
                          });
                          const retry = onceMcpToggleRetry(() => run());
                          if (retry) onFailure?.(result.message, retry);
                        });
                      };
                      run();
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
                            const params = snapshotMcpTrySelectParams({ serverId: server.id, serverLabel: server.label });
                            const run = () => {
                              setMcpCallStatus("running");
                              setMcpCallActionState({ status: "running", params });
                              setMcpCallNote(`running: pglite_query on ${server.label} (enabled=${server.enabled})`);
                              void runMcpTrySelect(params, (input) => mcpRegistryCall(input)).then((result) => {
                                if (result.ok) {
                                  setMcpCallStatus("ok");
                                  setMcpCallActionState({ status: "ok", note: result.note });
                                  setMcpCallNote(result.note);
                                  return;
                                }
                                setMcpCallStatus(result.kind === "network_failure" && /timed out|timeout/i.test(result.message) ? "timeout" : "error");
                                setMcpCallActionState({
                                  status: "error",
                                  kind: result.kind,
                                  message: result.message,
                                  params: result.params,
                                });
                                setMcpCallNote(null);
                                const retry = onceMcpCallRetry(() => run());
                                if (retry) onFailure?.(result.message, retry);
                              });
                            };
                            run();
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
          }) : null}
          <McpToggleActionStatusRows
            state={mcpToggleActionState}
            onRetry={
              mcpToggleActionState.status === "error"
                ? onceMcpToggleRetry(() => {
                    const params = mcpToggleActionState.params;
                    const run = () => {
                      setMcpToggleActionState({ status: "running", params });
                      void runMcpToggle(params, mcpRegistryToggle).then((result) => {
                        if (result.ok) {
                          setMcpToggleActionState({ status: "ok", note: result.note });
                          setMcpServers(result.servers);
                          loadMcpTools();
                          return;
                        }
                        setMcpToggleActionState({
                          status: "error",
                          kind: result.kind,
                          message: result.message,
                          params: result.params,
                        });
                        const retry = onceMcpToggleRetry(() => run());
                        if (retry) onFailure?.(result.message, retry);
                      });
                    };
                    run();
                  }) ?? (() => undefined)
                : () => undefined
            }
          />
          <McpListStatusRows state={mcpListState} onRetry={onceListRetry(loadMcpServers)} />
          <McpToolsListStatusRows state={mcpToolsState} onRetry={onceListRetry(loadMcpTools)} />
        </ul>
        <McpCallActionStatusRows
          state={mcpCallActionState}
          onRetry={
            mcpCallActionState.status === "error"
              ? onceMcpCallRetry(() => {
                  const params = mcpCallActionState.params;
                  const run = () => {
                    setMcpCallStatus("running");
                    setMcpCallActionState({ status: "running", params });
                    void runMcpTrySelect(params, (input) => mcpRegistryCall(input)).then((result) => {
                      if (result.ok) {
                        setMcpCallStatus("ok");
                        setMcpCallActionState({ status: "ok", note: result.note });
                        setMcpCallNote(result.note);
                        return;
                      }
                      setMcpCallStatus("error");
                      setMcpCallActionState({
                        status: "error",
                        kind: result.kind,
                        message: result.message,
                        params: result.params,
                      });
                      setMcpCallNote(null);
                      const retry = onceMcpCallRetry(() => run());
                      if (retry) onFailure?.(result.message, retry);
                    });
                  };
                  run();
                }) ?? (() => undefined)
              : () => undefined
          }
        />
        {mcpCallNote && mcpCallActionState.status !== "error" ? <p className="whitespace-pre-wrap text-sm text-muted">Tool result ({mcpCallStatus}): {mcpCallNote}</p> : null}
        <CustomConnections halted={ws.halted} />
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
