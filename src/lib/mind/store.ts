import { createHash } from "node:crypto";
import type { Sql } from "../db";
import type { Workspace } from "./types";
import { applyWorkspaceDelta, workspaceJsonBytes } from "./workspace-delta.ts";

import { canonical, mergeMemoryState, normalizeWorkspace } from "./workspace.ts";

const MAX_JSON = 1_500_000;

export function snapshotTooLarge(ws: Workspace): boolean {
  return workspaceJsonBytes(ws) > MAX_JSON;
}

async function withOwnerSnapshot<T>(sql: Sql, userId: string, fn: (tx: Sql, raw: unknown) => Promise<T>): Promise<T> {
  if (!sql.transaction) return fn(sql, await readSnapshot(sql, userId));
  return sql.transaction(async (tx) => {
    // Create a lockable row even on the owner's first save. All snapshot writers use this lock.
    await tx`insert into mind_snapshot (user_id, payload, updated_at) values (${userId}, '{}'::jsonb, now()) on conflict (user_id) do nothing`;
    const rows = await tx<{ payload: unknown }>`select payload from mind_snapshot where user_id = ${userId} for update`;
    return fn(tx, parsedPayload(rows[0]?.payload));
  });
}

export function updateOwnerWorkspace<T>(sql: Sql, userId: string, change: (current: Workspace, raw: unknown) => { workspace?: Workspace; result: T }): Promise<T> {
  return withOwnerSnapshot(sql, userId, async (tx, raw) => {
    const current = normalizeWorkspace(raw);
    const { workspace, result } = change(current, raw);
    if (workspace) await persistSnapshot(tx, userId, workspace, current);
    return result;
  });
}

export function snapshotRevision(workspace: unknown): string {
  return createHash("sha256").update(canonical(workspace ?? {})).digest("hex");
}

export function writeSnapshot(sql: Sql, userId: string, ws: Workspace, expectedRevision?: string): Promise<string | null> {
  return updateOwnerWorkspace<string | null>(sql, userId, (current, raw) => {
    if (expectedRevision !== undefined && snapshotRevision(raw) !== expectedRevision) return { result: null };
    const workspace = { ...ws, ...mergeMemoryState(current, ws) };
    return { workspace, result: snapshotRevision(workspace) };
  });
}

/** Changes are applied under the same owner lock/revision contract as full checkpoints. */
export function writeSnapshotDelta(sql: Sql, userId: string, delta: unknown, expectedRevision: string): Promise<{ revision: string; workspace: Workspace } | null> {
  return updateOwnerWorkspace<{ revision: string; workspace: Workspace } | null>(sql, userId, (current, raw) => {
    if (snapshotRevision(raw) !== expectedRevision) return { result: null };
    const applied = applyWorkspaceDelta(current, delta);
    const workspace = { ...applied, ...mergeMemoryState(current, applied) };
    return { workspace, result: { revision: snapshotRevision(workspace), workspace } };
  });
}

const mirroredCollections = {
  projects: "mind_project", chats: "mind_chat", memories: "mind_memory", files: "mind_file",
  audit: "mind_audit", usage: "mind_usage", agents: "mind_agent", runs: "mind_agent_run",
  runEvents: "mind_agent_event", connections: "mind_connection", mailboxes: "mind_mailbox",
  schedules: "mind_schedule", deployments: "mind_deployment",
} as const;

function changedRows<K extends keyof typeof mirroredCollections>(next: Workspace, previous: Workspace, key: K): Workspace[K] {
  const before = new Map(previous[key].map((row) => [row.id, row]));
  return next[key].filter((row) => canonical(before.get(row.id)) !== canonical(row)) as Workspace[K];
}

async function persistSnapshot(sql: Sql, userId: string, ws: Workspace, previous: Workspace): Promise<void> {
  const payload = JSON.stringify(ws);
  // Only removed/replaced rows change. Unrelated projects/chats are not deleted and reinserted.
  // Table identifiers come exclusively from this static allowlist; all data stays parameterized.
  for (const [key, table] of Object.entries(mirroredCollections)) {
    const collection = key as keyof typeof mirroredCollections;
    const next = new Map(ws[collection].map((row) => [row.id, row]));
    for (const before of previous[collection]) {
      if (canonical(before) !== canonical(next.get(before.id))) {
        await sql.query(`delete from ${table} where user_id = $1 and id = $2`, [userId, before.id]);
      }
    }
  }
  for (const project of changedRows(ws, previous, "projects")) {
    await sql`insert into mind_project (user_id, id, name, description, created_at) values (${userId}, ${project.id}, ${project.name}, ${project.description}, ${project.createdAt})`;
  }
  for (const chat of changedRows(ws, previous, "chats")) {
    await sql`insert into mind_chat (user_id, id, project_id, title, memory, autonomy, temporary, messages, retrieval_log) values (${userId}, ${chat.id}, ${chat.projectId}, ${chat.title}, ${chat.memory}, ${chat.autonomy}, ${chat.temporary}, ${JSON.stringify(chat.messages)}::jsonb, ${JSON.stringify(chat.retrievalLog)}::jsonb)`;
  }
  for (const note of changedRows(ws, previous, "memories")) {
    await sql`insert into mind_memory (user_id, id, scope, project_id, chat_id, body, source, archived, versions, created_at, updated_at) values (${userId}, ${note.id}, ${note.scope}, ${note.projectId}, ${note.chatId}, ${note.text}, ${note.source}, ${note.archived}, ${JSON.stringify(note.versions)}::jsonb, ${note.createdAt}, ${note.updatedAt})`;
  }
  for (const file of changedRows(ws, previous, "files")) {
    await sql`insert into mind_file (user_id, id, project_id, name, bytes, text_copy, created_at) values (${userId}, ${file.id}, ${file.projectId}, ${file.name}, ${file.bytes}, ${file.text}, ${file.createdAt})`;
  }
  for (const entry of changedRows(ws, previous, "audit")) {
    await sql`insert into mind_audit (user_id, id, at, action, target, result) values (${userId}, ${entry.id}, ${entry.at}, ${entry.action}, ${entry.target}, ${entry.result})`;
  }
  for (const entry of changedRows(ws, previous, "usage")) {
    await sql`insert into mind_usage (user_id, id, chat_id, at, model, request_id, prompt_tokens, completion_tokens) values (${userId}, ${entry.id}, ${entry.chatId}, ${entry.at}, ${entry.model}, ${entry.requestId}, ${entry.promptTokens}, ${entry.completionTokens})`;
  }
  for (const agent of changedRows(ws, previous, "agents")) {
    await sql`insert into mind_agent (user_id, id, name, version, body) values (${userId}, ${agent.id}, ${agent.name}, ${agent.version}, ${JSON.stringify(agent)}::jsonb)`;
  }
  for (const run of changedRows(ws, previous, "runs")) {
    await sql`insert into mind_agent_run (user_id, id, agent_id, parent_id, state, body) values (${userId}, ${run.id}, ${run.agentId}, ${run.parentId}, ${run.state}, ${JSON.stringify(run)}::jsonb)`;
  }
  for (const event of changedRows(ws, previous, "runEvents")) {
    await sql`insert into mind_agent_event (user_id, id, run_id, at, kind, detail) values (${userId}, ${event.id}, ${event.runId}, ${event.at}, ${event.kind}, ${event.detail})`;
  }
  for (const connection of changedRows(ws, previous, "connections")) {
    await sql`insert into mind_connection (user_id, id, provider, label, status) values (${userId}, ${connection.id}, ${connection.provider}, ${connection.label}, ${connection.status})`;
  }
  for (const mailbox of changedRows(ws, previous, "mailboxes")) {
    await sql`insert into mind_mailbox (user_id, id, label, address, status) values (${userId}, ${mailbox.id}, ${mailbox.label}, ${mailbox.address}, ${mailbox.status})`;
  }
  for (const job of changedRows(ws, previous, "schedules")) {
    await sql`insert into mind_schedule (user_id, id, name, agent_id, next_run_at, enabled) values (${userId}, ${job.id}, ${job.name}, ${job.agentId}, ${job.nextRunAt}, ${job.enabled})`;
  }
  for (const deployment of changedRows(ws, previous, "deployments")) {
    await sql`insert into mind_deployment (user_id, id, agent_id, target, state) values (${userId}, ${deployment.id}, ${deployment.agentId}, ${deployment.target}, ${deployment.state})`;
  }
  await sql`insert into mind_snapshot (user_id, payload, updated_at) values (${userId}, ${payload}::jsonb, now()) on conflict (user_id) do update set payload = excluded.payload, updated_at = now()`;
}

export async function readSnapshot(sql: Sql, userId: string): Promise<unknown | null> {
  const rows = await sql<{ payload: unknown }>`select payload from mind_snapshot where user_id = ${userId}`;
  return parsedPayload(rows[0]?.payload);
}

function parsedPayload(payload: unknown): unknown {
  return typeof payload === "string" ? JSON.parse(payload) : payload ?? null;
}

export async function writeControl(sql: Sql, userId: string, halted: boolean): Promise<void> {
  await sql`insert into mind_control (user_id, halted, updated_at) values (${userId}, ${halted}, now()) on conflict (user_id) do update set halted = excluded.halted, updated_at = now()`;
}

export async function readControl(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ halted: boolean }>`select halted from mind_control where user_id = ${userId}`;
  return rows[0]?.halted === true;
}

export async function listSnapshotUserIds(sql: Sql): Promise<string[]> {
  const rows = await sql<{ user_id: string }>`select user_id from mind_snapshot`;
  return rows
    .map((row) => (typeof row.user_id === "string" ? row.user_id : ""))
    .filter((id) => id.length > 0)
    .slice(0, 500);
}
