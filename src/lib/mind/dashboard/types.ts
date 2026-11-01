export type Health = "healthy" | "stalled" | "blocked" | "idle";

export type DashboardBotId =
  | "grok-build"
  | "conductor"
  | "gap-dispatcher"
  | "rea-feature-hunter"
  | "merge-gate"
  | "visual-polish"
  | "logic"
  | "mcp-integration"
  | "media-integration"
  | "voice-integration"
  | "voice-wiring"
  | "error-banners"
  | "xai-verification"
  | "hp-pairing"
  | "dashboard"
  | "cosmos-painter"
  | "cosmos-light"
  | "cosmos-motion";

export type LockRecord = {
  file: string;
  owner: string;
  branch: string | null;
  status: string | null;
  claimed_at: string | null;
  released_at: string | null;
  commits: string[];
  notes: string;
  worktree: string | null;
  raw: Record<string, string>;
};

export type BotNode = {
  id: DashboardBotId;
  name: string;
  health: Health;
  lock: LockRecord | null;
  branch: string | null;
  lastActivityAt: string | null;
  commits: string[];
  notes: string;
  reason: string;
};

export type GitCommit = {
  sha: string;
  subject: string;
  author: string;
  date: string;
  branch: string;
};

export type NotionStopPoint = {
  text: string;
  blockId?: string;
};

export type SystemWeather = {
  label: string;
  tone: Health;
  summary: string;
};

export type DashboardStatus = {
  generatedAt: string;
  bots: BotNode[];
  commits: GitCommit[];
  notion: { available: true; stopPoints: NotionStopPoint[] } | { available: false; reason: string };
  conductor: { source: string; nudges: string[] };
  gapDispatcher: { source: string; items: Array<{ rank?: number; feature: string; status?: string }> };
  orchestrator: {
    owner: string | null;
    status: string | null;
    branch: string | null;
    claimed_at: string | null;
    notes: string;
    lockFile: string | null;
  };
  spend: { available: false; reason: string } | { available: true; entries: unknown[] };
  sources: {
    locksDir: string;
    repoDir: string;
    locksOk: boolean;
    gitOk: boolean;
    /** Where commits came from: live git, build-time snapshot, or none. */
    commitsSource?: "git" | "snapshot" | "none";
    commitsSnapshotAt?: string;
    /** Honest reason git data is missing (never silently green). */
    gitError?: string;
    /** Env override rejected by the path allowlist (fallback used). */
    locksRejected?: string;
    repoRejected?: string;
  };
  /** Lane constellations for the universe view */
  constellations: import("./constellations.ts").Constellation[];
  constellationEdges: import("./constellations.ts").ConstellationEdge[];
  weather: SystemWeather;
  notionGraph: import("./notion-graph.ts").NotionGraph;
  projects: import("./projects.ts").ProjectsDashboard;
  fleetPlan: import("./fleet-plan.ts").FleetPlan;
  /** Queue #5 — real git+lock timeline for the TIME scrubber. */
  timeline: import("./time-scrub.ts").Timeline;
  /** Queue #6 — drifting sky feed + glass list (real sources only). */
  skyFeed: import("./sky-feed.ts").SkyFeed;
  /** Queue #7 — burn/today/warnings from real spend adapter only. */
  money: import("./spend-core.ts").MoneyView;
  /** Real-data spark charts. */
  charts: import("./chart-series.ts").DashboardCharts;
  /** Queue #9 — per-bot Notion stop-point freshness from snapshot. */
  notionMirror: import("./notion-mirror.ts").NotionMirrorView;
};
