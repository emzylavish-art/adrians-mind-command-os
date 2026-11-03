/**
 * BuildSession store: process memory + mind_agent_run persistence (no new tables).
 */
import { randomUUID } from "node:crypto";
import type { Sql } from "../db";
import {
  BUILD_TERMINAL,
  createBuildSession,
  fromAgentRunBody,
  toAgentRunRow,
  type BuildSession,
  MAX_ACTIVE_SESSIONS_PER_OWNER,
} from "./build-session.ts";

const sessions = new Map<string, BuildSession>();
const idempotencyAliases = new Map<string, string>();
/** Abort controllers keyed by session id for cancel races. */
const aborts = new Map<string, AbortController>();
/** Subscribers for live SSE (seq-based). */
type Listener = (session: BuildSession, fromSeq: number) => void;
const listeners = new Map<string, Set<Listener>>();

export function resetBuildSessionStoreForTests(): void {
  sessions.clear();
  idempotencyAliases.clear();
  for (const c of aborts.values()) {
    try {
      c.abort();
    } catch {
      /* ignore */
    }
  }
  aborts.clear();
  listeners.clear();
}

export function getAbortController(sessionId: string): AbortController | undefined {
  return aborts.get(sessionId);
}

export function ensureAbortController(sessionId: string): AbortController {
  let existing = aborts.get(sessionId);
  if (existing && !existing.signal.aborted) return existing;
  existing = new AbortController();
  aborts.set(sessionId, existing);
  return existing;
}

export function abortSession(sessionId: string): void {
  const c = aborts.get(sessionId);
  if (c && !c.signal.aborted) c.abort();
}

export function subscribeSession(sessionId: string, listener: Listener): () => void {
  let set = listeners.get(sessionId);
  if (!set) {
    set = new Set();
    listeners.set(sessionId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(sessionId);
  };
}

function notify(session: BuildSession, fromSeq: number): void {
  const set = listeners.get(session.id);
  if (!set) return;
  for (const listener of [...set]) {
    try {
      listener(session, fromSeq);
    } catch {
      /* subscriber errors must not break the run */
    }
  }
}

export function memoryGet(sessionId: string): BuildSession | undefined {
  return sessions.get(sessionId);
}

export function memoryPut(session: BuildSession): BuildSession {
  const prev = sessions.get(session.id);
  const fromSeq = prev ? prev.lastSeq : -1;
  sessions.set(session.id, session);
  notify(session, fromSeq);
  return session;
}

export function countActiveForOwner(ownerId: string): number {
  let n = 0;
  for (const session of sessions.values()) {
    if (session.ownerId === ownerId && !BUILD_TERMINAL.has(session.status)) n += 1;
  }
  return n;
}

export function canStartAnother(ownerId: string): boolean {
  return countActiveForOwner(ownerId) < MAX_ACTIVE_SESSIONS_PER_OWNER;
}

export async function persistSession(sql: Sql, session: BuildSession): Promise<void> {
  const row = toAgentRunRow(session);
  await sql`
    insert into mind_agent_run (user_id, id, agent_id, parent_id, state, body)
    values (${session.ownerId}, ${row.id}, ${row.agentId}, ${row.parentId}, ${row.state}, ${JSON.stringify(row.body)}::jsonb)
    on conflict (user_id, id) do update set
      agent_id = excluded.agent_id,
      parent_id = excluded.parent_id,
      state = excluded.state,
      body = excluded.body
  `;
}

export async function loadSession(sql: Sql, ownerId: string, sessionId: string): Promise<BuildSession | null> {
  const mem = sessions.get(sessionId);
  if (mem) {
    if (mem.ownerId !== ownerId) return null;
    return mem;
  }
  const rows = await sql<{ body: unknown }>`
    select body from mind_agent_run where user_id = ${ownerId} and id = ${sessionId}
  `;
  const body = rows[0]?.body;
  const parsed = fromAgentRunBody(body, ownerId);
  if (!parsed) return null;
  if (parsed.ownerId !== ownerId) return null;
  sessions.set(parsed.id, parsed);
  return parsed;
}

export function mintSessionId(): string {
  return `bs_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function startInMemory(input: {
  ownerId: string;
  botId: string;
  goal: string;
  now?: string;
  id?: string;
}): BuildSession {
  const session = createBuildSession({
    id: input.id ?? mintSessionId(),
    ownerId: input.ownerId,
    botId: input.botId,
    goal: input.goal,
    now: input.now,
  });
  ensureAbortController(session.id);
  return memoryPut(session);
}

export function rememberIdempotency(ownerId: string, key: string, sessionId: string): void {
  if (!key) return;
  idempotencyAliases.set(`${ownerId}:${key}`, sessionId);
}

export function lookupIdempotency(ownerId: string, key: string): BuildSession | undefined {
  if (!key) return undefined;
  const id = idempotencyAliases.get(`${ownerId}:${key}`);
  return id ? sessions.get(id) : undefined;
}
