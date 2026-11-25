import { useEffect, useRef, useState } from "react";
import { conversationSharePath } from "@/lib/mind/conversation-actions";
import { BotBuilder } from "@/components/mind/bot-builder";
import { zoneIsValid } from "@/lib/mind/schedule-clock";
import { getBearerToken } from "@/lib/auth/client";
import { loadMcpWithHttpFallback } from "@/lib/mind/mcp-list-http";
import { inspectWebPage, mcpRegistryCall, mcpRegistryList, mcpRegistryToggle, mcpRegistryTools, mindStatus, paperclipStatus, workerHealth } from "@/lib/mind/server";
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

function readLocalTool(id: string, ws: Workspace): string {
  if (id === "list_projects") {
    if (ws.projects.length === 0) return "No projects stored in this browser.";
    return ws.projects.map((project) => project.name).join("\n");
  }
  if (id === "list_chats") {
    if (ws.chats.length === 0) return "No chats stored in this browser.";
    return ws.chats.map((chat) => chat.title || "Untitled chat").join("\n");
  }
  if (id === "search_notes") {
    const notes = ws.memories.filter((item) => !item.archived && item.text.trim());
    if (notes.length === 0) return "No notes stored in this browser.";
    return notes.slice(0, 12).map((item) => item.text.trim()).join("\n\n");
  }
  if (id === "delegate") return "Delegate is available from Runs. Choose an agent, type a goal, then press Queue run. This card does not start a run by itself.";
  if (id === "web_search") return "Web search is not configured on this card. Nothing was searched.";
  if (id === "browser") return "Open a page with the field above. This card does not browse on its own.";
  if (id === "gmail_read" || id === "gmail_send") return "No Gmail account is connected. Nothing was read or sent.";
  if (id === "model") return "This worker does not call a model. Use Chat for a reply.";
  return "This tool has no local result.";
}

export function FleetPanel({
  mode,
  ws,
  setWs,
  onFailure,
  logicRoutes = [],
  providerChoice,
  onSelectProvider,
  initialAgentId = "",
  focusRunId,
  onBotChat,
  onBotRun,
  onBotSchedule,
  onBotSelect,
  focusBotId,
  catalogModels = [],
}: {
  mode: "agents" | "runs" | "connected" | "scheduled" | "tools";
  ws: Workspace;
  setWs: (updater: (prev: Workspace) => Workspace) => void;
  onFailure?: (message: string, retry: () => void, surface?: "mcp" | "browser") => void;
  logicRoutes?: LogicRoutePublic[];
  providerChoice?: string;
  onSelectProvider?: (id: string) => void;
  initialAgentId?: string;
  focusRunId?: string | null;
  onBotChat?: (id: string, newThread?: boolean) => void;
  onBotRun?: (id: string) => void;
  onBotSchedule?: (id: string) => void;
  onBotSelect?: (id: string) => void;
  focusBotId?: string | null;
  catalogModels?: { id: string; label: string }[];
}) {
  const [note, setNote] = useState<string | null>(null);
  const [toolReadId, setToolReadId] = useState<string | null>(null);
  const [toolRead, setToolRead] = useState<string | null>(null);
  const [mutationState, setMutationState] = useState<FleetMutationActionState>({ status: "idle" });
  const [goal, setGoal] = useState("");
  const [runFilter, setRunFilter] = useState<"all" | "attention">("all");
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [agentId, setAgentId] = useState(initialAgentId);
  const [mailLabel, setMailLabel] = useState("");
  const [mailAddress, setMailAddress] = useState("");
  const [connectionLabel, setConnectionLabel] = useState("");
  const [provider, setProvider] = useState<string>(providerChoice ?? "openai");
  const [gmailBoard, setGmailBoard] = useState<{ state: string; detail: string }>({ state: "Checking", detail: "Checking connection…" });
  const [jobName, setJobName] = useState("");
  const [jobInstruction, setJobInstruction] = useState("");
  const [scheduleBand, setScheduleBand] = useState<"jobs" | "new">(initialAgentId ? "new" : "jobs");
  const [jobZone, setJobZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [jobHour, setJobHour] = useState("");
  const [scheduleAgentId, setScheduleAgentId] = useState(initialAgentId);
  const [scheduleError, setScheduleError] = useState("");
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
    void loadMcpList(() => loadMcpWithHttpFallback(() => mcpRegistryList(), "registry", { bearerToken: getBearerToken() }), { timeoutMs: MCP_LIST_LOAD_TIMEOUT_MS })
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
  const [paperclipSnapshot, setPaperclipSnapshot] = useState<{
    state: "loading" | "not_configured" | "unavailable" | "connected";
    message: string;
    agents: { id: string; name: string; status: string }[];
    runs: { id: string; agentId: string; status: string }[];
  } | null>(null);
  const paperclipAttempt = useRef(0);
  function reloadPaperclip() {
    const current = ++paperclipAttempt.current;
    setPaperclipSnapshot({ state: "loading", message: "Checking the real Paperclip service…", agents: [], runs: [] });
    void paperclipStatus()
      .then((status) => {
        if (current !== paperclipAttempt.current) return;
        setPaperclipSnapshot({ state: status.state, message: status.message, agents: status.agents, runs: status.runs });
      })
      .catch(() => {
        if (current !== paperclipAttempt.current) return;
        setPaperclipSnapshot({ state: "unavailable", message: "Paperclip status could not be loaded. No agents were marked as running.", agents: [], runs: [] });
      });
  }
  useEffect(() => {
    if (mode !== "agents") return;
    reloadPaperclip();
    return () => { paperclipAttempt.current += 1; };
  }, [mode]);

  const active = ws.agents.find((agent) => agent.id === agentId && !agent.archived) ?? null;

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
      case "add_schedule": {
        const result = addSchedule(
          current,
          params.name,
          params.agentId,
          params.intervalMinutes,
          undefined,
          params.timeZone,
          params.clockHour,
          params.clockMinute,
          params.instruction,
        );
        return result.ok ? { ...result, ws: setScheduleEnabled(result.ws, result.ws.schedules[0].id, false) } : result;
      }
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
      return false;
    }
    setMutationState({ status: "idle" });
    setWs(() => result.ws);
    setNote(null);
    return true;
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
    const paperclipLabel = paperclipSnapshot?.state === "connected"
      ? "Runtime connected"
      : paperclipSnapshot?.state === "loading"
        ? "Checking runtime"
        : paperclipSnapshot?.state === "not_configured"
          ? "Runtime not configured"
          : "Runtime unavailable";
    return (
      <section className="fleet-bots mx-4 mb-6 space-y-4 md:mx-6">
        <BotBuilder ws={ws} setWs={setWs} onChat={onBotChat} onRun={onBotRun} onSchedule={onBotSchedule} catalogModels={catalogModels}
          onSelect={onBotSelect} focusBotId={focusBotId}
          onDeploy={(agentId, target) => runMutation(snapshotFleetMutationParams({ kind: "deploy", agentId, target }))}
          onPin={(id) => setWs((prev) => togglePin(prev, "agent", id))} />
        <details className="bot-builder-card px-4 py-1">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Start from a template</summary>
          <img src="/brand/bot-template-studio.webp" alt="" width={960} height={320} loading="lazy" className="mb-3 h-28 w-full rounded-panel object-cover" />
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {AGENT_TEMPLATES.map((template) => (
              <button key={template.name} type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 py-1 text-left text-sm" onClick={() => runMutation(snapshotFleetMutationParams({ kind: "add_template", templateName: template.name }))}>
                <img src={botAvatarSrc(template.name)} alt="" className="bot-avatar-img size-8 shrink-0" />
                Add {template.name}
              </button>
            ))}
          </div>
        </details>
        <div className="mt-3 grid min-w-0 gap-2 rounded-panel border border-line p-3" data-testid="paperclip-runtime-status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="font-semibold">Paperclip runtime, optional</p><p className="mt-1 text-xs text-muted">Not required. Adrian-owned bots are saved on this device. This card only checks an external service.</p></div>
            <button
              type="button"
              data-testid="paperclip-refresh"
              className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50"
              disabled={paperclipSnapshot?.state === "loading"}
              onClick={reloadPaperclip}
            >
              Refresh status
            </button>
          </div>
          <span className={`runtime-status runtime-status--${paperclipSnapshot?.state ?? "loading"}`}>{paperclipLabel}</span>
          <p className="break-words text-sm text-muted" role="status">{paperclipSnapshot?.message ?? "Checking whether a real Paperclip service is available…"}</p>
          {paperclipSnapshot?.state === "connected" ? (
            <div className="grid gap-2 text-sm" data-testid="paperclip-live-agent-list">
              <p>{paperclipSnapshot.agents.length} agent(s) retrieved; {paperclipSnapshot.runs.length} recent run(s) retrieved.</p>
              {paperclipSnapshot.agents.length === 0 ? (
                <p className="text-muted">The service is reachable, but this company has no visible agents.</p>
              ) : (
                <ul className="grid gap-1">
                  {paperclipSnapshot.agents.map((agent) => (
                    <li key={agent.id} className="flex min-w-0 flex-wrap justify-between gap-2 rounded-panel bg-bg px-3 py-2">
                      <span className="min-w-0 break-words">{agent.name}</span>
                      <span className="text-muted">{agent.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
        {mutationBanner()}
        {note && mutationState.status !== "error" ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
      </section>
    );
  }

  if (mode === "runs") {
    const needsAttention = ws.runs.filter((run) => run.state === "waiting_approval" || run.state === "waiting_external" || run.state === "failed");
    const ordered = runFilter === "attention" ? needsAttention : ws.runs;
    const selected = ws.runs.find((run) => run.id === focusRunId);
    const runs = selected ? [selected, ...ordered.filter((run) => run.id !== selected.id)] : ordered;
    return (
      <section className="page-shell">
        <div className="page-hero mb-4">
        <h2 className="font-display text-3xl font-bold">Agent runs</h2>
        <p className="text-sm text-muted">Events come from the local worker. This does not call a model, send mail, or invent browser screenshots.</p>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(12rem,2fr)]">
          <label className="grid gap-1 text-sm">Bot<select aria-label="Choose agent" value={active?.id ?? ""} onChange={(event) => setAgentId(event.target.value)} className="min-h-11 min-w-0 rounded-panel border border-line bg-surface px-3 text-sm">
            <option value="">Choose agent</option>
            {ws.agents.filter((agent) => !agent.archived).map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select></label>
          <label className="grid gap-1 text-sm">Task<input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="What should this run do?" className="min-h-11 min-w-0 rounded-panel border border-line bg-surface px-3 text-sm" /></label>
          <button
            type="button"
            className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
            disabled={ws.halted || !active || !goal.trim()}
            onClick={() => {
              if (!active) {
                runMutation(snapshotFleetMutationParams({ kind: "enqueue_no_agent", goal }));
                return;
              }
              if (runMutation(snapshotFleetMutationParams({ kind: "enqueue", agentId: active.id, goal }))) setGoal("");
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
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Run filters" role="group">
          <button type="button" aria-pressed={runFilter === "all"} className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setRunFilter("all")}>All runs ({ws.runs.length})</button>
          <button type="button" aria-pressed={runFilter === "attention"} className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setRunFilter("attention")}>Needs attention ({needsAttention.length})</button>
        </div>
        <ul className="mt-4 space-y-3">
          {ws.runs.length === 0 && (
            <li className="empty-state">
              <img src="/empty/empty-activity.svg" alt="" />
              <p className="font-semibold">No runs yet</p>
              <p className="text-sm text-muted">Queue a run, then press Run worker once.</p>
            </li>
          )}
          {runs.length === 0 && ws.runs.length > 0 && <li className="text-sm text-muted">No runs need attention.</li>}
          {(showAllRuns ? runs : runs.slice(0, 20)).map((run) => {
            const events = ws.runEvents.filter((item) => item.runId === run.id);
            return (
            <li key={run.id} id={`run-${run.id}`} tabIndex={-1} className={`rounded-panel border bg-surface p-3 text-sm ${run.id === focusRunId ? "border-accent" : "border-line"}`}>
              <p className="break-words font-semibold">{run.goal}</p>
              <p className="text-muted">{ws.agents.find((agent) => agent.id === run.agentId)?.name ?? "Agent"} · {run.state.replaceAll("_", " ")}</p>
              {run.plan.length > 0 && <p className="mt-1 text-xs text-muted">Plan: {run.plan.map((step) => step.tool).join(" → ")}. Missing tools wait. They are not marked done.</p>}
              {run.result ? <p className="mt-1 whitespace-pre-wrap">{run.result}</p> : null}
              {run.error ? <p className="mt-1 text-danger">{run.error}</p> : null}
              {events.length > 0 && <details className="mt-2">
                <summary className="min-h-11 cursor-pointer py-2 text-sm">History · {events.length} events</summary>
                <ul className="space-y-1 text-xs text-muted">
                  {events.map((item) => <li key={item.id} className="break-words"><time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time> · {item.kind.replaceAll("_", " ")} · {item.detail}</li>)}
                </ul>
              </details>}
              <div className="mt-2 flex flex-wrap gap-2">
                {(run.state === "queued" || run.state === "running") ? <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => pauseRun(prev, run.id))}>Pause</button> : null}
                {(run.state === "paused" || run.state === "waiting_external") ? <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => resumeRun(prev, run.id))}>{run.state === "waiting_external" ? "Retry this step" : "Resume"}</button> : null}
                {!["completed", "failed", "canceled"].includes(run.state) ? <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => cancelRun(prev, run.id))}>Stop run</button> : null}
                {run.state === "waiting_approval" ? <>
                  {run.plan.some((step) => step.tool === "browser") ? <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => approveRunAction(prev, run.id, "browser"))}>Approve browser</button> : null}
                  {run.plan.some((step) => step.tool === "gmail_send") ? <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => approveRunAction(prev, run.id, "gmail_send"))}>Approve send</button> : null}
                </> : null}
              </div>
            </li>
          ); })}
        </ul>
        {runs.length > 20 && <button type="button" aria-expanded={showAllRuns} className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setShowAllRuns(!showAllRuns)}>{showAllRuns ? "Show fewer runs" : "Show older runs"}</button>}
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
            {["grok"].map((item) => {
              const label = "Grok";
              const route = logicRoutes.find((row) => row.id === item);
              const menu = route ? logicMenuState(route, route.id) : null;
              return (
                <option key={item} value={item} disabled={menu ? !menu.selectable : false}>
                  {menu ? `${menu.label} · ${route?.state}` : label}
                </option>
              );
            })}
            {catalogModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <input value={connectionLabel} onChange={(event) => setConnectionLabel(event.target.value)} placeholder="Connection name" className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm" />
          <button
            type="button"
            className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
            onClick={() => {
              const stored = provider === "nemotron" ? "openrouter" : provider === "grok" || provider === "openai" || provider === "anthropic" || provider === "gemini" || provider === "openrouter" || provider === "ollama" ? provider : null;
              const label = provider === "nemotron" && !connectionLabel.trim() ? "Nemotron" : connectionLabel;
              if (stored) runMutation(snapshotFleetMutationParams({ kind: "add_connection", provider: stored, label }));
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
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => document.getElementById("owner-service-board")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Google cards</button>
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
    return (
      <section className="page-shell">
        <div className="page-hero mb-4 flex items-center gap-3">
          <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
          <div>
            <h2 className="font-display text-3xl font-bold">Scheduled</h2>
            <p className="text-sm text-muted">Jobs wait on this device. Nothing runs until you start it.</p>
          </div>
        </div>
        <ul className="mb-2 space-y-2">
          <WorkerHealthStatusRows state={workerHealthState} onRetry={onceListRetry(loadWorkerHealth)} />
        </ul>
        <nav className="mt-3 flex flex-wrap gap-2" aria-label="Schedule groups">
          {([
            ["jobs", "Jobs"],
            ["new", "New job"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" className={`min-h-11 rounded-panel border px-3 text-sm ${scheduleBand === id ? "border-accent bg-accent text-accent-ink" : "border-line"}`} aria-pressed={scheduleBand === id} onClick={() => setScheduleBand(id)}>{label}</button>
          ))}
        </nav>
        <details className="mt-2 rounded-panel border border-line px-3 py-2 text-sm">
          <summary className="min-h-11 cursor-pointer">Worker command</summary>
          <p className="pb-2 text-xs text-muted">One pass: node --experimental-strip-types scripts/schedule-tick.mjs. Stay up: node --experimental-strip-types scripts/schedule-worker.mjs. Interval: MIND_WORKER_INTERVAL_MS.</p>
        </details>
        <div id="owner-scheduled" className="solid-form mt-4" hidden={scheduleBand !== "new"}>
          <p className="text-sm text-muted">Save a daily job, then choose Turn on to queue it while Adrian is open.</p>
          <div className="job-fields mt-3">
          <label className="text-sm">Name
            <input value={jobName} onChange={(event) => setJobName(event.target.value)} placeholder="Morning notes" aria-label="Job name" className="mt-1 min-h-11 w-full rounded-panel border border-line bg-surface px-3 text-sm" />
          </label>
          <label className="text-sm">Task instruction
            <textarea maxLength={2000} value={jobInstruction} onChange={(event) => setJobInstruction(event.target.value)} className="block min-h-11 w-full rounded-panel border border-line bg-surface p-2" />
          </label>
          <label className="text-sm">Time zone
            <input value={jobZone} onChange={(event) => setJobZone(event.target.value)} placeholder="America/Chicago" aria-label="Time zone" className="mt-1 min-h-11 w-full rounded-panel border border-line bg-surface px-3 text-sm" />
          </label>
          <label className="text-sm">Time
            <input type="time" step="60" value={jobHour} onChange={(event) => setJobHour(event.target.value)} aria-label="Time" className="mt-1 min-h-11 w-full rounded-panel border border-line bg-surface px-3 text-sm" />
          </label>
          <label className="text-sm">Agent
            <select aria-label="Schedule agent" value={scheduleAgentId} onChange={(event) => setScheduleAgentId(event.target.value)} className="mt-1 min-h-11 w-full rounded-panel border border-line bg-surface px-3 text-sm">
              <option value="">Choose an agent</option>
              {ws.agents.filter((agent) => !agent.archived).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-2">
          <button
            type="button"
            className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
            disabled={ws.halted || !scheduleAgentId}
            onClick={() => {
              const [hour, minute] = jobHour.split(":").map(Number);
              if (!jobInstruction.trim()) { setScheduleError("Enter the task for the agent."); return; }
              if (!jobName.trim()) { setScheduleError("Enter a job name."); return; }
              if (!jobHour.trim() || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
                setScheduleError("Choose an hour and minute.");
                return;
              }
              if (!zoneIsValid(jobZone.trim())) { setScheduleError("Enter a valid time zone, such as America/New_York."); return; }
              if (!ws.agents.some((agent) => agent.id === scheduleAgentId && !agent.archived)) {
                setScheduleError("Choose an active bot.");
                return;
              }
              setScheduleError("");
              const saved = runMutation(snapshotFleetMutationParams({
                kind: "add_schedule",
                name: jobName,
                instruction: jobInstruction.trim(),
                agentId: scheduleAgentId,
                intervalMinutes: 1440,
                timeZone: jobZone.trim(),
                clockHour: hour,
                clockMinute: minute,
              }));
              if (saved) {
                setJobName("");
                setJobInstruction("");
                setJobHour("");
                setScheduleAgentId("");
                setScheduleBand("jobs");
              }
            }}
          >
            Add daily job
          </button>
          {!scheduleAgentId ? <p className="text-xs text-muted">Choose an agent before saving this job.</p> : null}
          </div>
          {scheduleError && <p role="alert" className="text-sm text-danger">{scheduleError}</p>}
        </div>
        </div>
        <div hidden={scheduleBand !== "jobs"}>
        <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setWs((prev) => runDueSchedules(prev, new Date().toISOString()))}>Run due schedules</button>
        <ul className="mt-4 space-y-2">
          {ws.schedules.length === 0 && (
            <li className="empty-state">
              <img src="/empty/empty-activity.svg" alt="" />
              <p className="font-semibold">No schedules yet</p>
              <p className="text-sm text-muted">Add a daily job to queue local work.</p>
            </li>
          )}
          {ws.schedules.map((job) => {
            const bot = ws.agents.find((agent) => agent.id === job.agentId);
            const blocked = !bot || bot.archived;
            return (
            <li key={job.id} className="dense-card p-3 text-sm">
              <p className="font-semibold">{job.name}</p>
              <p className="text-sm">Task: {job.instruction || job.name}</p>
              <p className="text-sm text-muted">Runs in an open browser or a running local schedule worker.</p>
              <p className="mt-1 text-sm text-muted">{job.enabled ? (blocked ? "Blocked" : "On") : "Off"} · {bot?.name ?? "No bot assigned"}</p>
              <p className="text-sm text-muted">{job.clockHour == null ? `Every ${job.intervalMinutes} minutes` : `Daily at ${String(job.clockHour).padStart(2, "0")}:${String(job.clockMinute ?? 0).padStart(2, "0")} ${job.timeZone || "UTC"}`}</p>
              {blocked ? <p className="text-sm text-danger">{bot?.archived ? "Agent archived" : "Agent unavailable"}</p> : <p className="text-sm text-muted">Next due in your local time <time dateTime={job.nextRunAt}>{new Date(job.nextRunAt).toLocaleString()}</time></p>}
              {job.chatId && ws.chats.some((chat) => chat.id === job.chatId) && <a className="underline" href={conversationSharePath(job.chatId, ["chat"])}>Open conversation</a>}
              {job.lastQueuedRunId && <p>Last occurrence: {ws.runs.find((run) => run.id === job.lastQueuedRunId)?.state ?? "Run record unavailable"}</p>}
              {job.lastRunAt && <p>Last completed: {new Date(job.lastRunAt).toLocaleString()}</p>}
              {job.lastAttemptAt && <p>Last attempt: {new Date(job.lastAttemptAt).toLocaleString()}</p>}
              {job.lastError && <p className="text-sm text-danger">{job.lastError}</p>}
              {blocked && <label className="mt-2 block text-sm">Reassign bot
                <select value="" className="ml-2 min-h-11 max-w-full rounded-panel border border-line bg-surface px-2" onChange={(event) => {
                  const id = event.target.value;
                  setWs((prev) => ({ ...prev, schedules: prev.schedules.map((item) => item.id === job.id ? { ...item, agentId: id, lastError: "" } : item) }));
                }}>
                  <option value="" disabled>Choose an agent</option>
                  {ws.agents.filter((agent) => !agent.archived).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </label>}
              <button type="button" disabled={!job.enabled && (blocked || ws.halted)} className="mt-2 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setWs((prev) => setScheduleEnabled(prev, job.id, !job.enabled))}>{job.enabled ? "Turn off" : "Turn on for next occurrence"}</button>
              {!job.enabled && !blocked && job.nextRunAt < new Date().toISOString() && <button type="button" disabled={ws.halted} className="ml-2 min-h-11 rounded-panel border border-line px-3" onClick={() => setWs((prev) => setScheduleEnabled(prev, job.id, true, new Date().toISOString(), true))}>Queue one missed occurrence on next check</button>}
            </li>
          ); })}
        </ul>
        {mutationBanner()}
        {note && mutationState.status !== "error" ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
        </div>
      </section>
    );
  }


  return (
    <section className="page-shell">
      <div className="page-hero mb-4">
        <div className="flex items-center gap-3">
          <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
          <div>
            <h2 className="font-display text-3xl font-bold">Tools</h2>
            <p className="text-sm text-muted">Local reads run in the worker. Page inspect uses the browser driver only when you press Open page. Image, video, and model calls are not made here.</p>
          </div>
        </div>
      </div>
      <div id="owner-tools" className="mt-4 flex flex-wrap gap-2">
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
          <li key={tool.id}>
            <button
              type="button"
              className="tool-card dense-card flex w-full flex-col gap-1 p-3 text-left"
              data-available={tool.available ? "true" : "false"}
              aria-pressed={toolReadId === tool.id}
              onClick={() => {
                setToolReadId(tool.id);
                setToolRead(readLocalTool(tool.id, ws));
              }}
            >
              <span className="font-semibold">{tool.name} · {tool.available ? "Available" : "Not available"}</span>
              <span className="text-xs text-muted">{tool.reason}</span>
            </button>
          </li>
        ))}
      </ul>
      {toolRead ? (
        <section className="tool-read mt-4 rounded-panel border border-line bg-surface p-4 text-sm" aria-live="polite">
          <p className="font-semibold">Result</p>
          <pre className="mt-2 whitespace-pre-wrap text-sm text-muted">{toolRead}</pre>
        </section>
      ) : null}

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
