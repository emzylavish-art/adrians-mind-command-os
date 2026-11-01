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
  | "dashboard";

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
  };
};
