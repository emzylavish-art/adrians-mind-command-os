import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StorageService } from "./types.ts";

/**
 * Append-only upload log. Never write tokens or secrets.
 * Timestamps use Africa/Lagos (+01:00) per standing instruction.
 */

let auditPath = "/workspace/audit/media-integration/STORAGE_ROTATION.md";

export function setStorageAuditPath(next: string) {
  auditPath = next;
}

export function storageAuditPath() {
  return auditPath;
}

const SECRET_RE =
  /(Bearer\s+[A-Za-z0-9._-]+)|(ya29\.[A-Za-z0-9._-]+)|(sl\.[A-Za-z0-9._-]+)|(eyJ[A-Za-z0-9._-]+)|(access[_-]?token["']?\s*[:=]\s*["'][^"']+["'])/gi;

export function redactSecrets(text: string): string {
  return text.replace(SECRET_RE, "[REDACTED]");
}

/** Format now as ISO with explicit Africa/Lagos +01:00 offset. */
export function lagosTimestamp(date = new Date()): string {
  // Africa/Lagos is UTC+1 year-round (no DST).
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  const lagos = new Date(utc + 60 * 60_000);
  const y = lagos.getUTCFullYear();
  const m = String(lagos.getUTCMonth() + 1).padStart(2, "0");
  const d = String(lagos.getUTCDate()).padStart(2, "0");
  const hh = String(lagos.getUTCHours()).padStart(2, "0");
  const mm = String(lagos.getUTCMinutes()).padStart(2, "0");
  const ss = String(lagos.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}+01:00`;
}

export type AuditUploadEntry = {
  timestamp?: string;
  service: StorageService;
  accountEmail: string;
  fileName: string;
  bytes: number;
  remotePathOrId: string;
  usedBytes: number;
  capBytes: number;
  switchEvent?: string;
  note?: string;
};

function ensureHeader(path: string) {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      "# Media storage rotation log",
      "",
      "Append-only. No tokens or secrets. Times are Africa/Lagos (+01:00).",
      "",
      "| timestamp | service | account | file | bytes | remote | used/cap | switch |",
      "|---|---|---|---|---:|---|---|---|",
      "",
    ].join("\n"),
    "utf8",
  );
}

export function appendStorageAudit(entry: AuditUploadEntry, path = auditPath): void {
  ensureHeader(path);
  const ts = entry.timestamp ?? lagosTimestamp();
  const usedCap = `${entry.usedBytes}/${entry.capBytes}`;
  const switchCol = entry.switchEvent ? redactSecrets(entry.switchEvent) : "";
  const note = entry.note ? ` ${redactSecrets(entry.note)}` : "";
  const line = `| ${ts} | ${entry.service} | ${redactSecrets(entry.accountEmail)} | ${redactSecrets(entry.fileName)} | ${entry.bytes} | ${redactSecrets(entry.remotePathOrId)} | ${usedCap} | ${switchCol}${note} |`;
  appendFileSync(path, `${line}\n`, "utf8");
}

export function readAuditRaw(path = auditPath): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}
