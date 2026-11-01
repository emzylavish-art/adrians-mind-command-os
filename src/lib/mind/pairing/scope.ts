/**
 * Device action scopes — reuse existing governance classes from policy.ts.
 * file-edit and terminal only; protected kinds still require owner approval.
 */
import { classifyAction, decide, type Autonomy } from "../policy.ts";

export const DEVICE_SCOPES = ["file-edit", "terminal"] as const;
export type DeviceScope = (typeof DEVICE_SCOPES)[number];

export type DeviceActionKind = "file_read" | "file_write" | "file_delete" | "terminal";

const KIND_TO_SCOPE: Record<DeviceActionKind, DeviceScope> = {
  file_read: "file-edit",
  file_write: "file-edit",
  file_delete: "file-edit",
  terminal: "terminal",
};

const KIND_TO_POLICY: Record<DeviceActionKind, string> = {
  file_read: "lookup",
  file_write: "overwrite",
  file_delete: "delete",
  terminal: "deploy",
};

/** Paths the device agent may touch (relative to an allowed workspace root). */
const BLOCKED_PATH_FRAGMENTS = [
  "..\\",
  "../",
  "..%2f",
  "..%5c",
  "%2e%2e",
  "\\windows\\",
  "/windows/",
  "\\system32\\",
  "/system32/",
  "\\program files\\",
  "/etc/",
  "\\etc\\",
];

const BLOCKED_COMMAND_PATTERNS = [
  /[;&|`$]/,
  /\brm\s+-rf\b/i,
  /\bdel\s+\/[sq]\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\breg\s+add\b/i,
  /\bnet\s+user\b/i,
  /\bpowershell\s+-enc/i,
  /\bcurl\b.*\|\s*iex/i,
  /\bwget\b.*\|\s*iex/i,
];

export function scopeForKind(kind: DeviceActionKind): DeviceScope {
  return KIND_TO_SCOPE[kind];
}

export function deviceHasScope(scopes: string[], kind: DeviceActionKind): boolean {
  return scopes.includes(KIND_TO_SCOPE[kind]);
}

export function normalizePathForCheck(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}

export function isPathInScope(path: string, allowedRoots: string[]): { ok: true } | { ok: false; reason: string } {
  if (!path || typeof path !== "string") return { ok: false, reason: "Path is required." };
  const raw = path.trim();
  if (!raw) return { ok: false, reason: "Path is required." };
  const lowered = normalizePathForCheck(raw);
  for (const frag of BLOCKED_PATH_FRAGMENTS) {
    if (lowered.includes(frag.toLowerCase())) {
      return { ok: false, reason: "Path escapes the allowed workspace (traversal or system path)." };
    }
  }
  // Reject absolute paths outside allowed roots
  const isAbs = /^[a-z]:\\/.test(lowered) || lowered.startsWith("\\\\") || raw.startsWith("/");
  if (isAbs) {
    const okRoot = allowedRoots.some((root) => {
      const n = normalizePathForCheck(root);
      return lowered === n || lowered.startsWith(n.endsWith("\\") ? n : `${n}\\`);
    });
    if (!okRoot) return { ok: false, reason: "Absolute path is outside allowed roots." };
  }
  // Reject symlink-looking tricks in the string itself
  if (lowered.includes("\\.") && /\\\.\.?(\\|$)/.test(lowered)) {
    return { ok: false, reason: "Path contains a parent or current-dir segment that is not allowed." };
  }
  return { ok: true };
}

export function isCommandInScope(command: string, args: string[] = []): { ok: true } | { ok: false; reason: string } {
  if (!command || typeof command !== "string") return { ok: false, reason: "Command is required." };
  const full = [command, ...args].join(" ");
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(full)) {
      return { ok: false, reason: "Command matches a blocked injection or destructive pattern." };
    }
  }
  // Argument injection via embedded nulls / newlines
  if (/[\0\r\n]/.test(full)) {
    return { ok: false, reason: "Command contains control characters." };
  }
  return { ok: true };
}

export function governanceAllowsDeviceAction(input: {
  kind: DeviceActionKind;
  halted: boolean;
  autonomy: Autonomy;
  approvalToken: string | null;
  actionId: string;
}): { ok: true } | { ok: false; reason: string } {
  const policyKind = KIND_TO_POLICY[input.kind];
  const decision = decide({
    autonomy: input.autonomy,
    kind: policyKind,
    halted: input.halted,
    approvalToken: input.approvalToken,
    expectedToken: `approve:${input.actionId}`,
  });
  if (decision.decision === "allow") return { ok: true };
  return { ok: false, reason: decision.reason };
}

export function actionClassForDevice(kind: DeviceActionKind) {
  return classifyAction(KIND_TO_POLICY[kind]);
}
