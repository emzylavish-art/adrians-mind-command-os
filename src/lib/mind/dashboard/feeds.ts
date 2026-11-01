import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LockRecord } from "./types.ts";

export function loadGapDispatcherFeed(capturesDir = "/workspace/rea-captures"): {
  source: string;
  items: Array<{ rank?: number; feature: string; status?: string }>;
} {
  try {
    if (!existsSync(capturesDir)) {
      return { source: "unavailable", items: [] };
    }
    const files = readdirSync(capturesDir)
      .filter((f) => /^gap-list-.*\.json$/i.test(f))
      .map((f) => {
        const path = join(capturesDir, f);
        let mtime = 0;
        try { mtime = statSync(path).mtimeMs; } catch { /* ignore */ }
        const cycleBoost = /c(\d+)/i.test(f) ? Number(RegExp.$1) * 1e12 : 0;
        return { f, path, score: mtime + cycleBoost };
      })
      .sort((a, b) => b.score - a.score);
    const json = files[0]?.f;
    if (!json) {
      return { source: "unavailable", items: [] };
    }
    const path = join(capturesDir, json);
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      gaps?: Array<{ rank?: number; feature?: string; status?: string }>;
    };
    const items = (data.gaps ?? [])
      .filter((g) => typeof g.feature === "string" && g.feature.trim())
      .map((g) => ({
        rank: typeof g.rank === "number" ? g.rank : undefined,
        feature: g.feature!.trim(),
        status: g.status,
      }));
    return { source: path, items };
  } catch {
    return { source: "unavailable", items: [] };
  }
}

export function loadConductorNudges(workspaceRoot = "/workspace"): {
  source: string;
  nudges: string[];
} {
  const candidates = [
    join(workspaceRoot, "conductor-nudges.json"),
    join(workspaceRoot, "conductor", "nudges.json"),
    join(workspaceRoot, "rea-captures", "conductor-nudges.json"),
    join(workspaceRoot, "mind-command-os", ".handoff", "CONDUCTOR.md"),
    join(workspaceRoot, ".handoff", "CONDUCTOR.md"),
  ];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      if (path.endsWith(".json")) {
        const data = JSON.parse(readFileSync(path, "utf8")) as { nudges?: string[] } | string[];
        const nudges = Array.isArray(data) ? data : data.nudges ?? [];
        if (nudges.length) return { source: path, nudges: nudges.map(String) };
      } else {
        const text = readFileSync(path, "utf8").trim();
        if (text) {
          return {
            source: path,
            nudges: text
              .split("\n")
              .map((l) => l.trim())
              .filter((l) => l && !l.startsWith("#")),
          };
        }
      }
    } catch {
      // continue
    }
  }
  return { source: "unavailable", nudges: [] };
}

export function loadSpend():
  | { available: false; reason: string }
  | { available: true; entries: unknown[] } {
  const roots = ["/workspace", "/workspace/.handoff", "/workspace/mind-command-os-xai"];
  const hits: string[] = [];
  for (const root of roots) {
    try {
      if (!existsSync(root)) continue;
      const names = readdirSync(root);
      for (const name of names) {
        if (/spend|usage|cost/i.test(name) && /\.(json|log|csv|md)$/i.test(name)) {
          hits.push(join(root, name));
        }
      }
    } catch {
      // skip
    }
  }
  // shallow search under /workspace/*xai*
  try {
    for (const name of readdirSync("/workspace")) {
      if (!/xai/i.test(name)) continue;
      const dir = join("/workspace", name);
      try {
        for (const f of readdirSync(dir)) {
          if (/spend|usage|cost/i.test(f) && /\.(json|log|csv|md)$/i.test(f)) {
            hits.push(join(dir, f));
          }
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }

  if (!hits.length) {
    return {
      available: false,
      reason: "No spend/usage/cost log found under /workspace (.handoff, *xai*, scripts).",
    };
  }

  const entries: unknown[] = [];
  for (const path of hits.slice(0, 5)) {
    try {
      const text = readFileSync(path, "utf8");
      if (path.endsWith(".json")) entries.push({ path, data: JSON.parse(text) });
      else entries.push({ path, preview: text.slice(0, 500) });
    } catch (err) {
      entries.push({ path, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { available: true, entries };
}

export function orchestratorFromLocks(locks: LockRecord[]): {
  owner: string | null;
  status: string | null;
  branch: string | null;
  claimed_at: string | null;
  notes: string;
  lockFile: string | null;
} {
  const hit =
    locks.find((l) => l.file === "integration.lock") ||
    locks.find((l) => /^grok\s*build$/i.test(l.owner)) ||
    null;
  if (!hit) {
    return {
      owner: null,
      status: null,
      branch: null,
      claimed_at: null,
      notes: "No integration.lock / Grok Build lock found.",
      lockFile: null,
    };
  }
  return {
    owner: hit.owner || null,
    status: hit.status,
    branch: hit.branch,
    claimed_at: hit.claimed_at,
    notes: hit.notes,
    lockFile: hit.file,
  };
}
