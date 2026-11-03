/**
 * Build-time git commits snapshot for hosts without a .git tree (e.g. Vercel).
 * Never invents commits — only returns what the JSON file contains.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitCommit } from "./types.ts";

export type CommitsSnapshot = {
  generatedAt: string;
  source: string;
  commits: GitCommit[];
};

const CANDIDATES = [
  join(process.cwd(), "src/lib/mind/dashboard/commits-snapshot.json"),
  join(process.cwd(), "scripts/dashboard/commits-snapshot.json"),
  "/workspace/mind-command-os-dashboard/src/lib/mind/dashboard/commits-snapshot.json",
];

export function loadCommitsSnapshot(candidates: string[] = CANDIDATES): CommitsSnapshot | null {
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<CommitsSnapshot>;
      if (!raw || !Array.isArray(raw.commits) || !raw.commits.length) continue;
      const commits: GitCommit[] = [];
      for (const c of raw.commits) {
        if (!c || typeof c !== "object") continue;
        const sha = typeof c.sha === "string" ? c.sha.trim() : "";
        if (!sha) continue;
        commits.push({
          sha,
          author: typeof c.author === "string" ? c.author : "",
          date: typeof c.date === "string" ? c.date : "",
          branch: typeof c.branch === "string" ? c.branch : "unknown",
          subject: typeof c.subject === "string" ? c.subject : "",
        });
      }
      if (!commits.length) continue;
      return {
        generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
        source: typeof raw.source === "string" ? raw.source : "commits-snapshot",
        commits,
      };
    } catch {
      /* try next */
    }
  }
  return null;
}
