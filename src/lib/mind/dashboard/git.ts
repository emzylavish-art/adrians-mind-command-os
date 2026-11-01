import { execFileSync } from "node:child_process";
import type { GitCommit } from "./types.ts";
import { allKnownBotBranches, sanitizeGitBranchName } from "./bot-branches.ts";
import { repoDirFromEnvSafe } from "./safe-paths.ts";

export function repoDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return repoDirFromEnvSafe(env).path;
}

function runGit(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export type CommitsResult = { ok: true; commits: GitCommit[] } | { ok: false; commits: []; error: string };

/**
 * Hacker-pass (2026-11-01 c8): collectRecentCommits swallowed git failures and returned [],
 * so status reported `gitOk: true` (green "git live") even when the repo was missing/broken.
 * This variant reports the failure honestly.
 */
export function collectRecentCommitsResult(repo: string, limit = 20): CommitsResult {
  try {
    runGit(repo, ["rev-parse", "--git-dir"]);
  } catch (error) {
    const msg = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    return { ok: false, commits: [], error: `git unavailable at ${repo}: ${msg}`.slice(0, 240) };
  }
  return { ok: true, commits: collectRecentCommits(repo, limit) };
}

/** Recent commits across branches via for-each-ref + log. */
export function collectRecentCommits(repo: string, limit = 20): GitCommit[] {
  const safeLimit = Number.isFinite(limit) ? Math.min(200, Math.max(1, Math.floor(limit))) : 20;
  limit = safeLimit;
  let refs = "";
  try {
    refs = runGit(repo, [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname:short)|%(objectname:short)|%(authorname)|%(committerdate:iso-strict)|%(subject)",
      "refs/heads",
      "refs/remotes/origin",
    ]);
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const fromRefs: GitCommit[] = [];
  for (const line of refs.split("\n")) {
    if (!line.trim()) continue;
    const [branch, sha, author, date, ...rest] = line.split("|");
    if (!sha || seen.has(sha)) continue;
    seen.add(sha);
    fromRefs.push({
      sha,
      branch: (branch ?? "").replace(/^origin\//, ""),
      author: author ?? "",
      date: date ?? "",
      subject: rest.join("|"),
    });
    if (fromRefs.length >= limit) break;
  }

  // Also pull a flat recent log in case some SHAs aren't tip of a branch
  try {
    const log = runGit(repo, [
      "log",
      "--all",
      `-n${limit}`,
      "--format=%h|%an|%aI|%D|%s",
    ]);
    for (const line of log.split("\n")) {
      if (!line.trim()) continue;
      const [sha, author, date, deco, ...rest] = line.split("|");
      if (!sha || seen.has(sha)) continue;
      seen.add(sha);
      const branch =
        (deco ?? "")
          .split(",")
          .map((s) => s.trim())
          .find((s) => s.startsWith("origin/") || s.startsWith("HEAD ->") || (!s.includes("tag:") && s.length > 0))
          ?.replace(/^HEAD -> /, "")
          .replace(/^origin\//, "") || "unknown";
      fromRefs.push({
        sha,
        author: author ?? "",
        date: date ?? "",
        branch,
        subject: rest.join("|"),
      });
      if (fromRefs.length >= limit) break;
    }
  } catch {
    // ignore
  }

  const ms = (d: string) => {
    const v = Date.parse(d);
    return Number.isFinite(v) ? v : 0;
  };
  fromRefs.sort((a, b) => ms(b.date) - ms(a.date));
  return fromRefs.slice(0, limit);
}

export function latestCommitActivityForBranch(
  commits: GitCommit[],
  branch: string | null,
): string | null {
  if (!branch) return null;
  const hit = commits.find((c) => c.branch === branch || c.branch.endsWith(`/${branch}`));
  return hit?.date ?? null;
}

/** Fleet + dashboard branches used by the TIME scrubber (queue #5). */
export const TIMELINE_GIT_BRANCHES = [
  "dashboard-3d",
  "dashboard-3d-visual-painter",
  "dashboard-3d-visual-light",
  "dashboard-3d-visual-motion",
] as const;

/**
 * Commits from named branches only (local or origin/). Hacker: per-branch cap,
 * skips missing refs, never throws — caller merges into the timeline builder.
 */
export function collectBranchCommits(
  repo: string,
  branches: readonly string[] = TIMELINE_GIT_BRANCHES,
  limitPerBranch = 80,
): GitCommit[] {
  const per = Number.isFinite(limitPerBranch)
    ? Math.min(500, Math.max(1, Math.floor(limitPerBranch)))
    : 80;
  const seen = new Set<string>();
  const out: GitCommit[] = [];
  for (const branch of branches) {
    const short = sanitizeGitBranchName(branch);
    if (!short) continue;
    const candidates = [short, `origin/${short}`];
    let log = "";
    for (const ref of candidates) {
      try {
        log = runGit(repo, [
          "log",
          ref,
          `-n${per}`,
          "--format=%h|%an|%aI|%s",
        ]);
        if (log.trim()) break;
      } catch {
        // try next ref
      }
    }
    if (!log.trim()) continue;
    for (const line of log.split("\n")) {
      if (!line.trim()) continue;
      const [sha, author, date, ...rest] = line.split("|");
      if (!sha || seen.has(sha)) continue;
      seen.add(sha);
      out.push({
        sha,
        author: author ?? "",
        date: date ?? "",
        branch: short,
        subject: rest.join("|"),
      });
    }
  }
  const ms = (d: string) => {
    const v = Date.parse(d);
    return Number.isFinite(v) ? v : 0;
  };
  out.sort((a, b) => ms(b.date) - ms(a.date));
  return out;
}

type BranchCommitCache = { at: number; commits: GitCommit[] };
let branchCommitCache: BranchCommitCache | null = null;
export const BRANCH_COMMIT_CACHE_MS = 30_000;
/** Per-branch cap when collecting the full known-bot set (status rebuild). */
export const KNOWN_BOT_COMMITS_PER_BRANCH = 12;

/**
 * Bounded, sanitized, cached git log across every known bot branch.
 * Attackers: huge limits clamp; dirty branch names are skipped.
 */
export function collectKnownBotBranchCommits(
  repo: string,
  nowMs = Date.now(),
  opts?: { limitPerBranch?: number; cacheMs?: number; branches?: readonly string[] },
): GitCommit[] {
  const cacheMs = opts?.cacheMs ?? BRANCH_COMMIT_CACHE_MS;
  if (branchCommitCache && nowMs - branchCommitCache.at < cacheMs) {
    return branchCommitCache.commits;
  }
  const per = opts?.limitPerBranch ?? KNOWN_BOT_COMMITS_PER_BRANCH;
  const branches = opts?.branches ?? allKnownBotBranches();
  const commits = collectBranchCommits(repo, branches, per);
  branchCommitCache = { at: nowMs, commits };
  return commits;
}

/** Test helper — drop the cache between attacker cases. */
export function clearBranchCommitCache(): void {
  branchCommitCache = null;
}
