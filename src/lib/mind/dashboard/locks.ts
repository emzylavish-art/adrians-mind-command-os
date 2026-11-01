import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LockRecord } from "./types.ts";

/**
 * Parse a YAML-ish lock file used by Mind OS lane bots.
 * Supports simple `key: value` lines and `|` block scalars for notes.
 */
export function parseLockText(text: string, file = "lock.lock"): LockRecord {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const raw: Record<string, string> = {};
  const commits: string[] = [];
  let i = 0;
  let notes = "";

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith("#")) {
      i += 1;
      continue;
    }

    const kv = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = kv[1]!;
    const value = kv[2] ?? "";

    if (value === "|" || value === ">") {
      const block: string[] = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (next.length === 0) {
          block.push("");
          i += 1;
          continue;
        }
        if (/^\S/.test(next) && !/^\s/.test(next)) break;
        block.push(next.replace(/^\s{2}/, ""));
        i += 1;
      }
      const joined = block.join("\n").trimEnd();
      raw[key] = joined;
      if (key === "notes") notes = joined;
      continue;
    }

    if (key === "commits" && value === "") {
      i += 1;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        const item = next.match(/^\s*-\s+(.*)$/);
        if (!item) break;
        commits.push(item[1]!.trim());
        i += 1;
      }
      continue;
    }

    if (key === "commits" && value.startsWith("[")) {
      // rare inline list — ignore structure, keep raw
      raw[key] = value;
      i += 1;
      continue;
    }

    if (value === "" && (key === "paths" || key === "paths_claimed" || key === "paths_in_use" || key === "avoid" || key === "evidence" || key === "source_platforms")) {
      i += 1;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (!/^\s*-\s+/.test(next) && next.trim() !== "") break;
        if (!/^\s*-\s+/.test(next)) {
          i += 1;
          continue;
        }
        i += 1;
      }
      continue;
    }

    raw[key] = value.trim();
    if (key === "notes") notes = value.trim();
    i += 1;
  }

  const owner =
    raw.owner?.trim() ||
    raw.owner_bot?.trim() ||
    raw.claimed_by?.trim() ||
    "";

  return {
    file,
    owner,
    branch: raw.branch?.trim() || null,
    status: raw.status?.trim() || null,
    claimed_at: stripZoneParen(raw.claimed_at || raw.timestamp || null),
    released_at: stripZoneParen(raw.released_at || null),
    commits,
    notes: notes || raw.notes || "",
    worktree: raw.worktree?.trim() || null,
    raw,
  };
}

function stripZoneParen(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\s*\(Africa\/Lagos\)\s*$/i, "").trim() || null;
}

export function readLocksDir(dir: string): LockRecord[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".lock"));
  } catch {
    return [];
  }
  const out: LockRecord[] = [];
  for (const name of names) {
    try {
      const text = readFileSync(join(dir, name), "utf8");
      out.push(parseLockText(text, name));
    } catch {
      // skip unreadable
    }
  }
  return out;
}

export function locksDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.MIND_LOCKS_DIR?.trim() || "/workspace/locks";
}
