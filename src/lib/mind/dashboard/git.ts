import { execFileSync } from "node:child_process";
import type { GitCommit } from "./types.ts";

export function repoDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.MIND_REPO_DIR?.trim() || "/workspace/mind-command-os";
}

function runGit(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 15_000,
  });
}

/** Recent commits across branches via for-each-ref + log. */
export function collectRecentCommits(repo: string, limit = 20): GitCommit[] {
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

  fromRefs.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
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
