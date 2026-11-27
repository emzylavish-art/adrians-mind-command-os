import type { BotNode, DashboardStatus, GitCommit, Health, LockRecord } from "./types.ts";

export type ProjectTask = {
  id: string;
  title: string;
  status: "open" | "done";
  source: string;
};

export type ProjectBuilding = {
  id: string;
  name: string;
  kind: "project" | "bot";
  progress: number; // 0..1 from real done/(open+done); 0 when unknown
  /** False when there is no real task ratio — UI must say "unknown", not paint fake floors. */
  progressKnown: boolean;
  openTasks: number;
  doneTasks: number;
  tasks: ProjectTask[];
  recentRuns: Array<{ id: string; label: string; at: string | null; ok: boolean | null }>;
  bots: string[];
  lastActivityAt: string | null;
  health: Health;
  notes: string;
  emptyReason?: string;
};

export type AgentStat = {
  basis?: "development";
  botId: string;
  name: string;
  runs: number;
  success: number;
  failure: number;
  lastActive: string | null;
  health: Health;
  branch: string | null;
};

export type ProjectsDashboard = {
  available: boolean;
  reason?: string;
  projects: ProjectBuilding[];
  agents: AgentStat[];
  generatedAt: string;
};

function tasksFromGapItems(
  items: Array<{ rank?: number; feature: string; status?: string }>,
): ProjectTask[] {
  return items.map((g, i) => ({
    id: `gap-${g.rank ?? i}`,
    title: g.feature,
    status: /closed|done|complete/i.test(g.status ?? "") ? "done" : "open",
    source: "gap-dispatcher",
  }));
}

function botBuilding(bot: BotNode): ProjectBuilding {
  // Lock commits carry no timestamp or CI result — don't invent either.
  const commits = bot.commits.map((c, i) => ({
    id: `c-${bot.id}-${i}`,
    label: c,
    at: null as string | null,
    ok: null as boolean | null,
  }));
  const released = /done|released/i.test(bot.lock?.status ?? "");
  // Honest progress: only a released/done lock is a known completed unit of work.
  // (Previously healthy=0.55 / stalled=0.35 / blocked=0.15 — fabricated percentages.)
  const progressKnown = Boolean(bot.lock) && released;
  const progress = progressKnown ? 1 : 0;
  return {
    id: `bot-${bot.id}`,
    name: bot.name,
    kind: "bot",
    progress,
    progressKnown,
    openTasks: bot.lock && !released ? 1 : 0,
    doneTasks: released ? 1 : 0,
    tasks: bot.lock
      ? [
          {
            id: `lock-${bot.id}`,
            title: bot.lock.status ?? "lock present (no status)",
            status: released ? "done" : "open",
            source: bot.lock.file,
          },
        ]
      : [],
    recentRuns: commits.slice(0, 5),
    bots: [bot.name],
    lastActivityAt: bot.lastActivityAt,
    health: bot.health,
    notes: bot.notes.slice(0, 240),
    emptyReason: bot.lock ? undefined : "No lock file for this bot — idle lane (no fake progress).",
  };
}

/** Build projects view from status + locks/git — never invents stats. */
export function buildProjectsDashboard(status: Omit<DashboardStatus, "projects" | "fleetPlan" | "skyFeed" | "money" | "charts" | "notionMirror">): ProjectsDashboard {
  const gapTasks = tasksFromGapItems(status.gapDispatcher.items);
  const projects: ProjectBuilding[] = [];

  if (gapTasks.length) {
    const done = gapTasks.filter((t) => t.status === "done").length;
    const open = gapTasks.filter((t) => t.status === "open").length;
    const progress = done + open > 0 ? done / (done + open) : 0;
    const bots = status.bots.filter((b) => b.health !== "idle").map((b) => b.name);
    projects.push({
      id: "project-gap-cycle",
      name: "Gap cycle (REA / Dispatcher)",
      kind: "project",
      progress,
      progressKnown: done + open > 0,
      openTasks: open,
      doneTasks: done,
      tasks: gapTasks.slice(0, 24),
      recentRuns: status.commits.slice(0, 8).map((c) => ({
        id: c.sha,
        label: `${c.sha} ${c.subject} (${c.branch})`,
        at: c.date || null,
        ok: null,
      })),
      bots: bots.slice(0, 12),
      lastActivityAt: status.commits[0]?.date ?? status.generatedAt,
      health: status.weather.tone,
      notes: `Source: ${status.gapDispatcher.source}`,
    });
  } else {
    projects.push({
      id: "project-gap-cycle",
      name: "Gap cycle (REA / Dispatcher)",
      kind: "project",
      progress: 0,
      progressKnown: false,
      openTasks: 0,
      doneTasks: 0,
      tasks: [],
      recentRuns: [],
      bots: [],
      lastActivityAt: null,
      health: "idle",
      notes: "",
      emptyReason: `No gap list available (source: ${status.gapDispatcher.source}).`,
    });
  }

  // Orchestrator as a project building from integration lock
  const orch = status.orchestrator;
  projects.push({
    id: "project-orchestrator",
    name: "Integration / Orchestrator",
    kind: "project",
    progress: /done|released/i.test(orch.status ?? "") ? 1 : 0,
    progressKnown: /done|released/i.test(orch.status ?? ""),
    openTasks: orch.status && !/done|released/i.test(orch.status) ? 1 : 0,
    doneTasks: /done|released/i.test(orch.status ?? "") ? 1 : 0,
    tasks: orch.lockFile
      ? [
          {
            id: "orch-lock",
            title: `${orch.status ?? "unknown"} on ${orch.branch ?? "—"}`,
            status: /done|released/i.test(orch.status ?? "") ? "done" : "open",
            source: orch.lockFile,
          },
        ]
      : [],
    recentRuns: status.commits
      .filter((c) => /integration|preview/i.test(c.branch))
      .slice(0, 5)
      .map((c) => ({ id: c.sha, label: `${c.sha} ${c.subject}`, at: c.date || null, ok: null })),
    bots: orch.owner ? [orch.owner] : [],
    lastActivityAt: orch.claimed_at,
    health: status.bots.find((b) => b.id === "grok-build")?.health ?? "idle",
    notes: orch.notes.slice(0, 240),
    emptyReason: orch.lockFile ? undefined : "No integration.lock / Grok Build lock.",
  });

  for (const bot of status.bots) {
    projects.push(botBuilding(bot));
  }

  const agents: AgentStat[] = status.bots.map((b) => {
    const runLabels = b.commits.length;
    const released = /done|released/i.test(b.lock?.status ?? "");
    const blocked = b.health === "blocked";
    return {
      botId: b.id,
      name: b.name,
      basis: "development",
      runs: runLabels || (b.lock ? 1 : 0),
      // success = lock-reported commits on a released lock (or 1 released run with none listed)
      success: released ? Math.max(1, runLabels) : 0,
      failure: blocked ? 1 : 0,
      lastActive: b.lastActivityAt,
      health: b.health,
      branch: b.branch,
    };
  });

  return {
    available: true,
    projects,
    agents,
    generatedAt: status.generatedAt,
  };
}
