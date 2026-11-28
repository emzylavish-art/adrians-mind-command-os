import { useEffect, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import type { FinancialLedgerRow, FinancialSnapshot } from "@/lib/mind/financial-policy";
import { buildDraftKey, parseBuildDraft } from "@/lib/mind/kimi/build-review";
import { buildResultKey, parseBuildResult } from "@/lib/mind/kimi/build-result";
import type { Chat, Workspace } from "@/lib/mind/types";

type Destination = "account" | "models" | "connections" | "permissions" | "runs" | "scheduled" | "activity" | "voice" | "profile" | "dashboard" | "build" | "conversation";

function latestByTime<T>(records: readonly T[], stamp: (record: T) => string): T | undefined {
  return records.reduce<T | undefined>((latest, current) =>
    !latest || stamp(current) > stamp(latest) ? current : latest, undefined);
}

function readWorkSummary(ownerId: string | null, projectId: string | null) {
  if (!ownerId) return { branch: null, verified: null, status: null };
  try {
    const draft = parseBuildDraft(sessionStorage.getItem(buildDraftKey(ownerId, projectId)), ownerId, projectId);
    const result = parseBuildResult(localStorage.getItem(buildResultKey(ownerId, projectId)), ownerId, projectId);
    return { branch: draft?.branch?.trim() || null, verified: result?.receipt?.verifiedBranch ?? null, status: result?.job.status ?? null };
  } catch { return { branch: null, verified: null, status: null }; }
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 });
type CostRead = { state: "loading" | "unavailable" } | { state: "saved"; row?: FinancialLedgerRow };

function costDetail(cost: CostRead) {
  if (cost.state === "loading") return "Reading saved cost evidence…";
  if (cost.state === "unavailable") return "Saved cost evidence is unavailable.";
  if (!("row" in cost) || !cost.row) return "No retained cost receipt for this scope.";
  const row = cost.row;
  const charge = row.actualMicros === null ? "Actual USD unconfirmed" : `Actual ${usd.format(row.actualMicros / 1_000_000)}`;
  return `${row.provider} · ${row.model} · ${charge} · ${row.costBasis.replaceAll("_", " ")} · ${row.state}`;
}

export function WorkspaceControlCenter({ account, ownerId, thread, workProjectId, fromWork, workspace, selectedModel, freeOnly, listening, onOpen, onReturn, onReviewNotion }: {
  account: string;
  ownerId: string | null;
  thread: Chat | null;
  workProjectId: string | null;
  fromWork: boolean;
  workspace: Workspace;
  selectedModel: string;
  freeOnly: boolean;
  listening: boolean;
  onOpen: (destination: Destination, id?: string) => void;
  onReturn: () => void;
  onReviewNotion: (id: string) => Promise<string>;
}) {
  const [check, setCheck] = useState<{ id: string; pending: boolean; message: string } | null>(null);
  const project = workspace.projects.find((item) => item.id === thread?.projectId);
  const workProject = workspace.projects.find((item) => item.id === workProjectId);
  const costProjectId = fromWork ? workProjectId : project?.id ?? null;
  const [work, setWork] = useState<ReturnType<typeof readWorkSummary>>({ branch: null, verified: null, status: null });
  const [cost, setCost] = useState<CostRead>({ state: "loading" });
  useEffect(() => setWork(readWorkSummary(ownerId, workProjectId)), [ownerId, workProjectId]);
  useEffect(() => {
    if (!ownerId) { setCost({ state: "unavailable" }); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => { controller.abort(); setCost({ state: "unavailable" }); }, 10_000);
    setCost({ state: "loading" });
    const token = getBearerToken();
    void fetch(`/api/mind/dispatch-policy?section=financial&ownerId=${encodeURIComponent(ownerId)}`, {
      credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }).then(async response => {
      if (!response.ok) throw new Error();
      const result = await response.json() as { ok?: boolean; financial?: FinancialSnapshot };
      if (!result.ok || !Array.isArray(result.financial?.ledger)) throw new Error();
      const scoped = result.financial.ledger.filter(row => !costProjectId || row.projectId === costProjectId);
      if (!controller.signal.aborted) setCost({ state: "saved", row: latestByTime(scoped, row => row.updatedAt) });
    }).catch(() => { if (!controller.signal.aborted) setCost({ state: "unavailable" }); }).finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [ownerId, costProjectId]);
  const answer = latestByTime(thread?.messages.filter((message) =>
    message.role === "assistant" && message.kind !== "error" && (message.provider || message.model)) ?? [], (message) => message.at);
  const receipt = latestByTime(workspace.audit, (item) => item.at);
  const run = latestByTime(workspace.runs, (item) => item.updatedAt);
  const unresolved = latestByTime((workspace.recovery ?? []).filter((item) => item.state === "open"), (item) => item.at);
  const checkable = unresolved?.action === "notion_operation" && Boolean(unresolved.operationId && unresolved.workspaceId && unresolved.pageId && unresolved.text && unresolved.chatId);
  const recordedUsage = workspace.usage.filter((item) => item.kind === "actual" && (item.promptTokens != null || item.completionTokens != null)).length;
  const sections: { title: string; detail: string; actions: { label: string; target: Destination; id?: string }[] }[] = [
    { title: "Account and destination", detail: (fromWork ? [account, workProject?.name ?? "General Work"] : [account, project?.name ?? "No chat project selected", thread?.title ?? "No thread open"]).join(" · "), actions: [{ label: "Account settings", target: "account" }] },
    { title: "Models and helpers", detail: `Selected for Chat: ${selectedModel}. Latest attributed reply: ${answer ? [answer.provider, answer.model].filter(Boolean).join(" · ") : "unreported"}.`, actions: [{ label: "Model connections", target: "models" }] },
    { title: "Tools and permissions", detail: workspace.halted ? "Emergency stop is active." : "Review the authorized account and available actions before invoking a tool.", actions: [{ label: "Connections", target: "connections" }, { label: "Permission settings", target: "permissions" }] },
    { title: "Work queue", detail: run ? `Latest saved run: ${run.goal} · ${run.state.replaceAll("_", " ")}` : "No saved agent runs in this workspace.", actions: [{ label: "Open Build", target: "build" }, { label: "Runs and approvals", target: "runs", id: run?.id }, { label: "Schedules", target: "scheduled" }] },
    { title: "Activity and receipts", detail: receipt ? `${receipt.action.replaceAll("_", " ")} · ${receipt.result}` : "No saved activity receipts in this workspace.", actions: [{ label: "Inspect activity", target: "activity", id: receipt?.id }] },
    { title: "Voice and devices", detail: listening ? "Speak reports active microphone capture." : "Speak microphone capture is inactive.", actions: [{ label: "Voice and dictation settings", target: "voice" }] },
    { title: "Usage and graphs", detail: `${recordedUsage} usage records include reported tokens.${freeOnly ? " Free-only is selected." : ""}`, actions: [{ label: "Usage and budgets", target: "models" }, { label: "Token activity", target: "profile" }, { label: "Fleet graph", target: "dashboard" }] },
    { title: "Recovery and handoff", detail: unresolved ? `${unresolved.target} · ${unresolved.message}` : "No open recovery entries in this workspace.", actions: [{ label: "Open recovery activity", target: "activity" }] },
  ];

  return <section className="page-shell space-y-4" aria-labelledby="workspace-control-title">
    <header className="page-hero card-texture flex flex-wrap items-center justify-between gap-4">
      <h1 id="workspace-control-title" className="font-display text-3xl font-bold">Control Center</h1>
      <button type="button" onClick={onReturn} className="min-h-11 rounded-panel border border-line px-3 text-sm">Return to workspace</button>
    </header>
    <div className="grid gap-3 lg:grid-cols-2">
      {sections.map(({ title, detail, actions }) => <section key={title} className="dense-card min-w-0 space-y-2 p-4">
        <h2 className="font-semibold">{title}</h2>
        <p className="break-words text-sm text-muted">{detail}</p>
        {title === "Work queue" && <dl className="grid gap-1 break-words text-sm">
          <div><dt className="inline text-muted">Build project · </dt><dd className="inline">{workProject?.name ?? "General Work"}</dd></div>
          <div><dt className="inline text-muted">Draft target branch · </dt><dd className="inline">{work.branch ?? "Unspecified"}</dd></div>
          <div><dt className="inline text-muted">Latest saved Build run · </dt><dd className="inline">{work.status?.replaceAll("_", " ") ?? "Unavailable"}{work.verified ? ` · verified checkout ${work.verified}` : ""}</dd></div>
        </dl>}
        {title === "Usage and graphs" && <p className="break-words text-sm"><span className="text-muted">Latest cost for {fromWork ? workProject?.name ?? "this account" : project?.name ?? "this account"} · </span>{costDetail(cost)}</p>}
        {title === "Recovery and handoff" && unresolved && <>
          {unresolved.workspaceId && <p className="break-all text-sm">Workspace · {unresolved.workspaceId}</p>}
          {unresolved.pageId && <p className="break-all text-sm">Page · {unresolved.pageId}</p>}
          {unresolved.operationId && <p className="break-all text-sm">Operation · {unresolved.operationId}</p>}
          {unresolved.outcome && <p className="text-sm">Saved outcome · {unresolved.outcome.replaceAll("_", " ")}</p>}
          <div className="flex flex-wrap gap-2">
            {checkable && <button type="button" disabled={check?.pending} className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => {
              setCheck({ id: unresolved.id, pending: true, message: "Checking the saved operation…" });
              void onReviewNotion(unresolved.id).then(message => setCheck({ id: unresolved.id, pending: false, message }));
            }}>Check saved Notion write</button>}
            {unresolved.chatId && workspace.chats.some(chat => chat.id === unresolved.chatId && !chat.temporary && !chat.archived) &&
              <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => onOpen("conversation", unresolved.chatId)}>Open source conversation</button>}
          </div>
        </>}
        {title === "Recovery and handoff" && check && <p role="status" className="text-sm">{check.message}</p>}
        <div className="flex flex-wrap gap-2">
          {actions.map(({ label, target, id }) => <button type="button" key={label} onClick={() => onOpen(target, id)} className="min-h-11 rounded-panel border border-line px-3 text-sm">{label}</button>)}
        </div>
      </section>)}
    </div>
  </section>;
}
