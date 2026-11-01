import { randomUUID } from "node:crypto";
import { consumeMindRateLimit } from "./limits.ts";

export const MAX_EXECUTION_LEDGER_ENTRIES = 2_000;
export const EXECUTION_LEDGER_TTL_MS = 10 * 60_000;
export const RECORD_EXECUTION_RATE_LIMIT = 20;
export const RECORD_EXECUTION_RATE_LIMIT_REPLY = "Too many execution records. Wait a minute and try again.";

export type ExecutionAction = "chat" | "voice";
export type ExecutionOutcome = {
  tool: string;
  action: ExecutionAction;
  ok: boolean;
  detail: string;
};

type LedgerEntry = {
  userId: string;
  outcome: ExecutionOutcome;
  issuedAt: number;
  consumed: boolean;
};

const ledger = new Map<string, LedgerEntry>();

function pruneLedger(now: number): void {
  // Keep consumed receipts until TTL so replays are rejected as "already recorded".
  for (const [id, entry] of ledger) {
    if (now - entry.issuedAt > EXECUTION_LEDGER_TTL_MS) {
      ledger.delete(id);
    }
  }
  if (ledger.size <= MAX_EXECUTION_LEDGER_ENTRIES) return;
  const ordered = [...ledger.entries()].sort((a, b) => a[1].issuedAt - b[1].issuedAt);
  const excess = ledger.size - MAX_EXECUTION_LEDGER_ENTRIES;
  for (let i = 0; i < excess; i += 1) {
    ledger.delete(ordered[i]![0]);
  }
}

/** Server-side: mint a one-shot receipt after a tool actually ran. */
export function issueServerExecution(userId: string, outcome: ExecutionOutcome, now = Date.now()): string {
  pruneLedger(now);
  const id = randomUUID();
  ledger.set(id, {
    userId,
    outcome: {
      tool: outcome.tool.slice(0, 80),
      action: outcome.action === "voice" ? "voice" : "chat",
      ok: outcome.ok === true,
      detail: outcome.detail.slice(0, 500),
    },
    issuedAt: now,
    consumed: false,
  });
  pruneLedger(now);
  return id;
}

export function consumeServerExecution(
  userId: string,
  id: string,
  now = Date.now(),
): { ok: true; outcome: ExecutionOutcome } | { ok: false; error: string } {
  pruneLedger(now);
  const entry = ledger.get(id);
  if (!entry || entry.userId !== userId) {
    return { ok: false, error: "That execution id is not recognized. Nothing was recorded." };
  }
  if (entry.consumed) {
    return { ok: false, error: "That execution was already recorded." };
  }
  entry.consumed = true;
  ledger.set(id, entry);
  return { ok: true, outcome: entry.outcome };
}

export type RecordIssuedResult =
  | { ok: true }
  | { ok: false; error: string; rateLimited?: boolean; retryAfterSec?: number };

/**
 * Persist a server-issued execution once. Client ok/detail are ignored.
 * Rate-limits before ledger lookup so floods get 429 without probing ids.
 */
export async function recordIssuedExecution(input: {
  userId: string;
  id: string;
  clientOk?: boolean;
  clientDetail?: string;
  rateLimit?: number;
  write: (run: { id: string; tool: string; action: ExecutionAction; ok: boolean; detail: string }) => Promise<void>;
  now?: number;
}): Promise<RecordIssuedResult> {
  void input.clientOk;
  void input.clientDetail;
  const now = input.now ?? Date.now();
  const limited = consumeMindRateLimit("record-exec", input.userId, input.rateLimit ?? RECORD_EXECUTION_RATE_LIMIT, 60_000, now);
  if (!limited.ok) {
    return { ok: false, error: RECORD_EXECUTION_RATE_LIMIT_REPLY, rateLimited: true, retryAfterSec: limited.retryAfterSec };
  }
  if (!input.id.trim()) {
    return { ok: false, error: "That execution id is not recognized. Nothing was recorded." };
  }
  const consumed = consumeServerExecution(input.userId, input.id.trim(), now);
  if (!consumed.ok) return { ok: false, error: consumed.error };
  await input.write({
    id: input.id.trim(),
    tool: consumed.outcome.tool,
    action: consumed.outcome.action,
    ok: consumed.outcome.ok,
    detail: consumed.outcome.detail,
  });
  return { ok: true };
}

export function resetExecutionLedgerForTests(): void {
  ledger.clear();
}

export function executionLedgerSizeForTests(): number {
  return ledger.size;
}
