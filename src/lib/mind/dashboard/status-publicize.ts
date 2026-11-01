/**
 * Gap #29 — strip box internals from the dashboard status API payload.
 * Never invent fields; only redact / omit what the client does not need.
 */

const ABS_PATH_RE = /(?:^|[\s"'`(])(\/(?:workspace|home|Users|var|tmp|private)[^\s"'`)\]},]*)/g;
const KEY_SHAPED_RE =
  /\b(?:sk-[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{20,}|AIza[0-9A-Za-z\-_]{20,}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,})\b/g;

/** Map an absolute box path to a safe label (basename, or repo-relative under /workspace/). */
export function publicPathLabel(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (!s.includes("/") && !s.startsWith("~")) return s;
  // /workspace/foo/bar -> foo/bar ; /workspace/locks/x.lock -> locks/x.lock
  const ws = s.match(/^\/workspace\/(.+)$/);
  if (ws) return ws[1]!;
  const base = s.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return base || "path";
}

/** Replace absolute paths and key-shaped tokens inside free text. */
const BARE_ABS_PATH_RE = /\/(?:workspace|home|Users|var|tmp|private)\/[^\s"'<>`)\]},]*/g;

export function redactSensitiveText(input: string | null | undefined): string {
  if (input == null) return "";
  let s = String(input);
  s = s.replace(ABS_PATH_RE, (full, path: string) => {
    const prefix = full.slice(0, full.length - path.length);
    return prefix + (publicPathLabel(path) ?? "path");
  });
  s = s.replace(BARE_ABS_PATH_RE, (path) => publicPathLabel(path) ?? "path");
  s = s.replace(KEY_SHAPED_RE, "[redacted]");
  return s;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function publicizeLock(lock: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!lock || typeof lock !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(lock)) {
    if (k === "raw") continue; // Gap#29: drop raw bag (heartbeatAt/task stay)
    if (k === "worktree") {
      out.worktree = publicPathLabel(typeof v === "string" ? v : null);
      continue;
    }
    if (typeof v === "string") {
      out[k] = redactSensitiveText(v);
      continue;
    }
    if (Array.isArray(v)) {
      out[k] = v.map((item) => (typeof item === "string" ? redactSensitiveText(item) : item));
      continue;
    }
    out[k] = v;
  }
  return out;
}

function walk(value: unknown, keyHint = ""): Json {
  if (value == null) return value as null;
  if (typeof value === "string") {
    if (keyHint === "locksDir" || keyHint === "repoDir" || keyHint === "worktree" || keyHint === "source") {
      // sources.locksDir / repoDir → label; feed source paths too
      if (value.includes("/workspace") || value.startsWith("/")) {
        return publicPathLabel(value) ?? "path";
      }
    }
    return redactSensitiveText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((v) => walk(v, keyHint));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Lock-shaped object
    if ("raw" in obj && ("file" in obj || "owner" in obj || "worktree" in obj)) {
      return publicizeLock(obj) as Json;
    }
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "raw" && v && typeof v === "object" && !Array.isArray(v)) {
        // any nested raw bags
        continue;
      }
      out[k] = walk(v, k);
    }
    return out;
  }
  return null;
}

/** Deep-clone status into a client-safe JSON value (no absolute box paths, no lock.raw). */
export function publicizeDashboardStatus<T>(status: T): T {
  return walk(status) as T;
}
