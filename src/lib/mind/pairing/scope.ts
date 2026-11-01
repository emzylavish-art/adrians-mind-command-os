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
  "\\\\", // UNC
  "//",
  "\\??\\",
  "\\\\?\\",
  "\\\\.\\",
  "\\??\\",
];

/** Windows reserved device names (any extension). */
const WIN_DEVICE_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

const BLOCKED_COMMAND_PATTERNS = [
  /[;&|`$]/,
  /\r|\n|\0/,
  /\brm\s+-rf\b/i,
  /\bdel\s+\/[sq]\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\breg\s+add\b/i,
  /\bnet\s+user\b/i,
  /\bpowershell\s+-enc/i,
  /\bpowershell\b.*\b-encodedcommand\b/i,
  /\bcmd\s*\/c\b/i,
  /\bcurl\b.*\|\s*iex/i,
  /\bwget\b.*\|\s*iex/i,
  /\binvoke-expression\b/i,
  /\biex\b/i,
  /\bstart-process\b/i,
  /\badd-type\b/i,
  /\bnew-object\s+net\.webclient\b/i,
  /%COMSPEC%/i,
  /%[^%\s]{1,64}%/, // env expansion smuggling in args
  /\^/, // cmd escape
  /</,
  />/,
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

function pathSegments(path: string): string[] {
  return normalizePathForCheck(path)
    .split("\\")
    .filter(Boolean)
    .map((s) => s.replace(/\.$/, ""));
}

export function isPathInScope(path: string, allowedRoots: string[]): { ok: true } | { ok: false; reason: string } {
  if (!path || typeof path !== "string") return { ok: false, reason: "Path is required." };
  const raw = path.trim();
  if (!raw) return { ok: false, reason: "Path is required." };
  const lowered = normalizePathForCheck(raw);

  // UNC / extended-length / device namespace
  if (lowered.startsWith("\\\\") || raw.startsWith("//") || lowered.includes("\\\\?\\") || lowered.includes("\\\\.\\") || lowered.includes("\\??\\")) {
    return { ok: false, reason: "UNC, extended-length, and device-namespace paths are not allowed." };
  }
  if (/^[a-z]:$/i.test(raw.trim()) || lowered === "\\" || lowered === "/") {
    return { ok: false, reason: "Root or drive paths are not allowed." };
  }

  for (const frag of BLOCKED_PATH_FRAGMENTS) {
    if (frag === "\\\\" || frag === "//") continue; // handled above for leading UNC
    if (lowered.includes(frag.toLowerCase())) {
      return { ok: false, reason: "Path escapes the allowed workspace (traversal or system path)." };
    }
  }

  // Junction / reparse markers in the string
  if (lowered.includes(":symlink") || lowered.includes("$reparse") || lowered.includes(":junction")) {
    return { ok: false, reason: "Junction/symlink markers are not allowed in paths." };
  }

  const segments = pathSegments(raw);
  for (const seg of segments) {
    const base = seg.split(".")[0] ?? seg;
    if (WIN_DEVICE_NAMES.has(base)) {
      return { ok: false, reason: "Windows reserved device name is not allowed." };
    }
    if (seg === "." || seg === "..") {
      return { ok: false, reason: "Path contains a parent or current-dir segment that is not allowed." };
    }
  }

  const isAbs = /^[a-z]:\\/.test(lowered) || raw.startsWith("/");
  if (isAbs) {
    const okRoot = allowedRoots.some((root) => {
      const n = normalizePathForCheck(root);
      const prefix = n.endsWith("\\") ? n : `${n}\\`;
      return lowered === n || lowered.startsWith(prefix);
    });
    if (!okRoot) return { ok: false, reason: "Absolute path is outside allowed roots." };
  }
  return { ok: true };
}

export function isCommandInScope(command: string, args: string[] = []): { ok: true } | { ok: false; reason: string } {
  if (!command || typeof command !== "string") return { ok: false, reason: "Command is required." };
  const full = [command, ...args].join(" ");
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(full) || pattern.test(command) || args.some((a) => pattern.test(a))) {
      return { ok: false, reason: "Command matches a blocked injection or destructive pattern." };
    }
  }
  if (/[\0\r\n]/.test(full)) {
    return { ok: false, reason: "Command contains control characters." };
  }
  // Argument smuggling via embedded quotes/escapes that close and append
  for (const a of args) {
    if (/(^|[^\\])".*;/.test(a) || /\$\(|`/.test(a)) {
      return { ok: false, reason: "Argument smuggling pattern blocked." };
    }
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
