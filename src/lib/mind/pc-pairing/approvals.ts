import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, relative, sep, isAbsolute } from "node:path";
import { localDataPath } from "../../local-data.ts";

export const PC_APPROVAL_TTL_MS = 3 * 60 * 1000;
export const PC_APPROVAL_ID_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;

export type PcApprovalStatus = "pending" | "used" | "denied" | "expired";

export type PcApprovalRecord = {
  id: string;
  /** Server-side only — never include in MCP tool results. */
  token: string;
  ownerId: string;
  command: string;
  commandHash: string;
  agentId: string;
  agentLabel: string;
  createdAt: string;
  expiresAt: string;
  status: PcApprovalStatus;
  usedAt?: string;
};

export type PcApprovalPublic = {
  id: string;
  token: string;
  command: string;
  agentId: string;
  agentLabel: string;
  createdAt: string;
  expiresAt: string;
  status: PcApprovalStatus;
};

let directory = localDataPath("mind-pc-approvals");

export function setPcApprovalDirectory(next: string) {
  directory = next;
}

export function hashCommand(command: string): string {
  return createHash("sha256").update(command).digest("hex");
}

function ensure() {
  mkdirSync(directory, { recursive: true });
}

function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function approvalPath(id: string): string | null {
  if (!PC_APPROVAL_ID_PATTERN.test(id) || id.includes("\0")) return null;
  const base = resolve(directory);
  const candidate = resolve(base, `${id}.json`);
  const rel = relative(base, candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.includes(`..${sep}`)) return null;
  if (!candidate.startsWith(base + sep)) return null;
  return candidate;
}

function writeRecord(record: PcApprovalRecord) {
  ensure();
  const path = approvalPath(record.id);
  if (!path) throw new Error("Invalid approval id.");
  writeFileSync(path, JSON.stringify(record));
}

function readRecord(id: string): PcApprovalRecord | null {
  const path = approvalPath(id);
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PcApprovalRecord;
  } catch {
    return null;
  }
}

export function pruneExpiredApprovals(nowMs = Date.now()): number {
  ensure();
  let touched = 0;
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    const path = approvalPath(id);
    if (!path) continue;
    try {
      const record = JSON.parse(readFileSync(path, "utf8")) as PcApprovalRecord;
      const exp = Date.parse(record.expiresAt);
      if (!Number.isFinite(exp)) {
        unlinkSync(path);
        touched += 1;
        continue;
      }
      if (nowMs > exp && record.status === "pending") {
        record.status = "expired";
        writeFileSync(path, JSON.stringify(record));
        touched += 1;
      }
      if (nowMs - exp > PC_APPROVAL_TTL_MS) {
        unlinkSync(path);
        touched += 1;
      }
    } catch {
      try {
        unlinkSync(path);
        touched += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return touched;
}

export function createPcApproval(input: {
  ownerId: string;
  command: string;
  agentId: string;
  agentLabel: string;
  nowMs?: number;
}): PcApprovalRecord {
  pruneExpiredApprovals(input.nowMs ?? Date.now());
  const now = input.nowMs ?? Date.now();
  const command = input.command.trim().slice(0, 500);
  const record: PcApprovalRecord = {
    id: randomBytes(18).toString("base64url"),
    token: randomBytes(24).toString("base64url"),
    ownerId: input.ownerId,
    command,
    commandHash: hashCommand(command),
    agentId: input.agentId,
    agentLabel: input.agentLabel.slice(0, 80),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PC_APPROVAL_TTL_MS).toISOString(),
    status: "pending",
  };
  writeRecord(record);
  return record;
}

export function listPendingApprovals(ownerId: string, nowMs = Date.now()): PcApprovalPublic[] {
  try {
    pruneExpiredApprovals(nowMs);
    ensure();
  } catch {
    return [];
  }
  const out: PcApprovalPublic[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const record = readRecord(name.slice(0, -".json".length));
    if (!record || record.ownerId !== ownerId) continue;
    const exp = Date.parse(record.expiresAt);
    if (record.status === "pending" && Number.isFinite(exp) && nowMs > exp) {
      record.status = "expired";
      writeRecord(record);
      continue;
    }
    if (record.status !== "pending") continue;
    out.push({
      id: record.id,
      token: record.token,
      command: record.command,
      agentId: record.agentId,
      agentLabel: record.agentLabel,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      status: record.status,
    });
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type ConsumeApprovalResult =
  | { ok: true; record: PcApprovalRecord }
  | { ok: false; error: string };

/** Single-use consume for authenticated human approve. */
export function consumePcApproval(input: {
  ownerId: string;
  approvalId: string;
  token: string;
  expectedCommand?: string;
  nowMs?: number;
}): ConsumeApprovalResult {
  const now = input.nowMs ?? Date.now();
  pruneExpiredApprovals(now);
  const record = readRecord(input.approvalId);
  if (!record) return { ok: false, error: "Approval not found or already used. Nothing ran." };
  if (!safeEqual(record.ownerId, input.ownerId)) {
    return { ok: false, error: "Approval does not belong to this account. Nothing ran." };
  }
  if (record.status !== "pending") {
    return { ok: false, error: `Approval is ${record.status}. Nothing ran.` };
  }
  const exp = Date.parse(record.expiresAt);
  if (!Number.isFinite(exp) || now > exp) {
    record.status = "expired";
    writeRecord(record);
    return { ok: false, error: "Approval expired. Nothing ran." };
  }
  if (!safeEqual(record.token, input.token)) {
    return { ok: false, error: "Approval token is invalid. Nothing ran." };
  }
  if (input.expectedCommand !== undefined) {
    if (hashCommand(input.expectedCommand.trim().slice(0, 500)) !== record.commandHash) {
      return { ok: false, error: "Approval command mismatch. Nothing ran." };
    }
  }
  record.status = "used";
  record.usedAt = new Date(now).toISOString();
  writeRecord(record);
  return { ok: true, record };
}

export function denyPcApproval(input: {
  ownerId: string;
  approvalId: string;
  token: string;
  nowMs?: number;
}): { ok: true } | { ok: false; error: string } {
  const now = input.nowMs ?? Date.now();
  const record = readRecord(input.approvalId);
  if (!record) return { ok: false, error: "Approval not found." };
  if (!safeEqual(record.ownerId, input.ownerId)) {
    return { ok: false, error: "Approval does not belong to this account." };
  }
  if (record.status !== "pending") return { ok: false, error: `Approval is ${record.status}.` };
  if (!safeEqual(record.token, input.token)) {
    return { ok: false, error: "Approval token is invalid." };
  }
  record.status = "denied";
  record.usedAt = new Date(now).toISOString();
  writeRecord(record);
  return { ok: true };
}
