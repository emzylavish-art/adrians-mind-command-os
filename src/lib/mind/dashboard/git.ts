import { execFileSync } from "node:child_process";
import type { GitCommit } from "./types.ts";
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
