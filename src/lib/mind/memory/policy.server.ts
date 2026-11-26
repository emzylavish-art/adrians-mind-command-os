import type { Sql } from "../../db.ts";
import { resolveDatabaseUrl } from "../../env.server.ts";

export type OwnerMemoryPolicy = { suspended: boolean; revision: number; updatedAt: string | null };
export const MEMORY_POLICY_UNAVAILABLE = "Account memory privacy could not be checked. No saved memory was sent. Retry when storage is available.";
export const MEMORY_SUSPENDED_DURING_TURN = "Memory was suspended for this account before dispatch. This send was stopped; start a new send with memory off.";

async function policySql(injected?: Sql): Promise<Sql> {
  if (injected) return injected;
  if ((process.env.VERCEL || process.env.GROK_PROJECT_ID) && !resolveDatabaseUrl()) throw new Error("Shared privacy storage is unavailable.");
  const { getSql } = await import("../../db.ts");
  return getSql();
}

/** Read on every dispatch. There is deliberately no process/browser policy cache. */
export async function readOwnerMemoryPolicy(ownerId: string, injected?: Sql): Promise<OwnerMemoryPolicy> {
  if (!ownerId) throw new Error("Sign in is required.");
  const sql = await policySql(injected);
  const rows = await sql<{ suspended: boolean; revision: number | string; updated_at: string | Date }>`select suspended, revision, updated_at from mind_memory_policy where user_id=${ownerId}`;
  const row = rows[0];
  if (!row) return { suspended: false, revision: 0, updatedAt: null };
  return { suspended: row.suspended === true, revision: Number(row.revision), updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at) };
}

/** Optimistic revision prevents an old tab from silently undoing a newer suspension. */
export async function writeOwnerMemoryPolicy(ownerId: string, suspended: boolean, expectedRevision: number, injected?: Sql): Promise<
  { ok: true; policy: OwnerMemoryPolicy } | { ok: false; error: string; conflict?: true }
> {
  if (!ownerId) return { ok: false, error: "Sign in is required." };
  if (typeof suspended !== "boolean" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return { ok: false, error: "Load the current memory setting before changing it." };
  try {
    const sql = await policySql(injected);
    const rows = expectedRevision === 0
      ? await sql<{ suspended: boolean; revision: number | string; updated_at: string | Date }>`insert into mind_memory_policy (user_id,suspended,revision) values (${ownerId},${suspended},1) on conflict (user_id) do nothing returning suspended,revision,updated_at`
      : await sql<{ suspended: boolean; revision: number | string; updated_at: string | Date }>`update mind_memory_policy set suspended=${suspended},revision=revision+1,updated_at=now() where user_id=${ownerId} and revision=${expectedRevision} returning suspended,revision,updated_at`;
    const row = rows[0];
    if (!row) return { ok: false, conflict: true, error: "The account memory setting changed in another session. Reload it before changing it again." };
    return { ok: true, policy: { suspended: row.suspended === true, revision: Number(row.revision), updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at) } };
  } catch { return { ok: false, error: "The account memory setting was not saved. Keep the current privacy state and retry." }; }
}

/** Preparation may safely clear notes; the final dispatch guard must instead stop an already assembled prompt. */
export async function applyOwnerMemoryPolicy<T extends { memory?: unknown; memoryContext?: unknown; saveMemory?: unknown; botKnowledge?: unknown; projectInstructions?: unknown; knowledgePassages?: unknown }>(ownerId: string, body: T, injected?: Sql): Promise<
  { ok: true; body: T; policy: OwnerMemoryPolicy; effectiveMemory: "on" | "off" } | { ok: false; error: string }
> {
  try {
    const policy = await readOwnerMemoryPolicy(ownerId, injected);
    return { ok: true, policy, body: policy.suspended ? { ...body, memory: "off", memoryContext: [], saveMemory: undefined, botKnowledge: "", projectInstructions: "", knowledgePassages: [] } : body, effectiveMemory: policy.suspended || body.memory !== "on" ? "off" : "on" };
  } catch { return { ok: false, error: MEMORY_POLICY_UNAVAILABLE }; }
}

export async function assertOwnerMemoryDispatch(ownerId: string, usedSavedMemory: boolean, injected?: Sql): Promise<{ ok: true } | { ok: false; error: string }> {
  // With no saved notes in the final prompt there is no saved-memory disclosure to block.
  if (!usedSavedMemory) return { ok: true };
  try {
    const policy = await readOwnerMemoryPolicy(ownerId, injected);
    return policy.suspended ? { ok: false, error: MEMORY_SUSPENDED_DURING_TURN } : { ok: true };
  } catch { return { ok: false, error: MEMORY_POLICY_UNAVAILABLE }; }
}
