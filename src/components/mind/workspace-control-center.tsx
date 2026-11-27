import type { Chat, Workspace } from "@/lib/mind/types";

type Destination = "account" | "models" | "connections" | "permissions" | "runs" | "scheduled" | "activity" | "voice" | "profile" | "dashboard";

function latestByTime<T>(records: readonly T[], stamp: (record: T) => string): T | undefined {
  return records.reduce<T | undefined>((latest, current) =>
    !latest || stamp(current) > stamp(latest) ? current : latest, undefined);
}

export function WorkspaceControlCenter({ account, thread, workspace, selectedModel, freeOnly, listening, onOpen, onReturn }: {
  account: string;
  thread: Chat | null;
  workspace: Workspace;
  selectedModel: string;
  freeOnly: boolean;
  listening: boolean;
  onOpen: (destination: Destination, id?: string) => void;
  onReturn: () => void;
}) {
  const project = workspace.projects.find((item) => item.id === thread?.projectId);
  const answer = latestByTime(thread?.messages.filter((message) =>
    message.role === "assistant" && message.kind !== "error" && (message.provider || message.model)) ?? [], (message) => message.at);
  const receipt = latestByTime(workspace.audit, (item) => item.at);
  const run = latestByTime(workspace.runs, (item) => item.updatedAt);
  const unresolved = latestByTime((workspace.recovery ?? []).filter((item) => item.state === "open"), (item) => item.at);
  const recordedUsage = workspace.usage.filter((item) => item.kind === "actual" && (item.promptTokens != null || item.completionTokens != null)).length;
  const sections: { title: string; detail: string; actions: { label: string; target: Destination; id?: string }[] }[] = [
    { title: "Account and destination", detail: [account, project?.name ?? "No chat project selected", thread?.title ?? "No thread open"].join(" · "), actions: [{ label: "Account settings", target: "account" }] },
    { title: "Models and helpers", detail: `Selected for Chat: ${selectedModel}. Latest attributed reply: ${answer ? [answer.provider, answer.model].filter(Boolean).join(" · ") : "unreported"}.`, actions: [{ label: "Model connections", target: "models" }] },
    { title: "Tools and permissions", detail: workspace.halted ? "Emergency stop is active." : "Review the authorized account and available actions before invoking a tool.", actions: [{ label: "Connections", target: "connections" }, { label: "Permission settings", target: "permissions" }] },
    { title: "Work queue", detail: run ? `Latest saved run: ${run.goal} · ${run.state.replaceAll("_", " ")}` : "No saved runs in this workspace.", actions: [{ label: "Runs and approvals", target: "runs", id: run?.id }, { label: "Schedules", target: "scheduled" }] },
    { title: "Activity and receipts", detail: receipt ? `${receipt.action.replaceAll("_", " ")} · ${receipt.result}` : "No saved activity receipts in this workspace.", actions: [{ label: "Inspect activity", target: "activity", id: receipt?.id }] },
    { title: "Voice and devices", detail: listening ? "Speak reports active microphone capture." : "Speak microphone capture is inactive.", actions: [{ label: "Voice and dictation settings", target: "voice" }] },
    { title: "Usage and graphs", detail: `${recordedUsage} usage records include reported tokens.${freeOnly ? " Free-only is selected." : ""}`, actions: [{ label: "Token activity", target: "profile" }, { label: "Fleet graph", target: "dashboard" }] },
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
        <div className="flex flex-wrap gap-2">
          {actions.map(({ label, target, id }) => <button type="button" key={label} onClick={() => onOpen(target, id)} className="min-h-11 rounded-panel border border-line px-3 text-sm">{label}</button>)}
        </div>
      </section>)}
    </div>
  </section>;
}
