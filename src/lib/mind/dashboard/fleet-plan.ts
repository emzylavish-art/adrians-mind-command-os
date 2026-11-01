import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { BotNode, Health } from "./types.ts";
import { parseDashboardQueueMarkdown, queueHead, type QueueItem } from "./queue-parse.ts";
import { inspectAllFleetLandings, type FleetLandingStatus } from "./landing-status.ts";
import { repoDirFromEnv } from "./git.ts";
import { execFileSync } from "node:child_process";

export type FleetStarStatus = {
  botId: string;
  lane: "painter" | "light" | "motion";
  name: string;
  health: Health;
  lockFile: string;
  status: string | null;
  workingOn: string;
  paths: string[];
  latestCommit: string | null;
  branch: string;
};

export type FleetPlan = {
  fleetStars: FleetStarStatus[];
  landings: FleetLandingStatus[];
  queue: QueueItem[];
  queueHead: QueueItem | null;
  mergeGateNote: string;
};

function latestCommitOnBranch(repo: string, branch: string): string | null {
  try {
    return execFileSync(
      "git",
      ["-C", repo, "log", "-1", "--format=%h %s", branch, "--"],
      { encoding: "utf8", timeout: 8000 },
    ).trim() || null;
  } catch {
    try {
      return execFileSync(
        "git",
        ["-C", repo, "log", "-1", "--format=%h %s", `origin/${branch}`, "--"],
        { encoding: "utf8", timeout: 8000 },
      ).trim() || null;
    } catch {
      return null;
    }
  }
}

function loadQueueFile(cwd = process.cwd()): QueueItem[] {
  const candidates = [
    join(cwd, ".handoff/DASHBOARD_QUEUE.md"),
    "/workspace/mind-command-os-dashboard/.handoff/DASHBOARD_QUEUE.md",
  ];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      return parseDashboardQueueMarkdown(readFileSync(path, "utf8"));
    } catch {
      // next
    }
  }
  return [];
}

const FLEET: Array<{ botId: string; lane: "painter" | "light" | "motion"; name: string; lockFile: string }> = [
  { botId: "cosmos-painter", lane: "painter", name: "Cosmos Painter Bot", lockFile: "dashboard-3d-visual-painter.lock" },
  { botId: "cosmos-light", lane: "light", name: "Cosmos Light Bot", lockFile: "dashboard-3d-visual-light.lock" },
  { botId: "cosmos-motion", lane: "motion", name: "Cosmos Motion Bot", lockFile: "dashboard-3d-visual-motion.lock" },
];

export function buildFleetPlan(bots: BotNode[], env: NodeJS.ProcessEnv = process.env): FleetPlan {
  const repo = repoDirFromEnv(env);
  // Prefer dashboard worktree for branch tips when present
  const tipRepo = existsSync("/workspace/mind-command-os-dashboard/.git")
    || existsSync("/workspace/mind-command-os-dashboard")
    ? "/workspace/mind-command-os-dashboard"
    : repo;

  const landings = inspectAllFleetLandings(tipRepo);
  const queue = loadQueueFile("/workspace/mind-command-os-dashboard");

  const fleetStars: FleetStarStatus[] = FLEET.map((f) => {
    const bot = bots.find((b) => b.id === f.botId);
    const paths: string[] = [];
    const rawPaths = bot?.lock?.raw?.paths || bot?.lock?.raw?.paths_claimed || "";
    // paths often parsed out — use notes + lock file list from notes
    const workingOn = (bot?.notes || bot?.lock?.notes || "Idle — no active claim.").trim().slice(0, 220);
    const latestCommit = latestCommitOnBranch(tipRepo, `dashboard-3d-visual-${f.lane}`);
    return {
      botId: f.botId,
      lane: f.lane,
      name: f.name,
      health: bot?.health ?? "idle",
      lockFile: f.lockFile,
      status: bot?.lock?.status ?? null,
      workingOn,
      paths,
      latestCommit,
      branch: `dashboard-3d-visual-${f.lane}`,
    };
  });

  return {
    fleetStars,
    landings,
    queue,
    queueHead: queueHead(queue),
    mergeGateNote:
      "Merge Gate Bot watches dashboard-3d (≈20-min cycle): preview/integration only when dashboard-3d.lock is released; main only with Zack's approval.",
  };
}
