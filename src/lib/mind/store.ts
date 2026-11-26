import { createHash } from "node:crypto";
import type { Sql } from "../db";
import type { Workspace } from "./types";

import { canonical, mergeMemoryState, normalizeWorkspace } from "./workspace.ts";

const MAX_JSON = 1_500_000;

export function snapshotTooLarge(ws: Workspace): boolean {
  return JSON.stringify(ws).length > MAX_JSON;
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
    const { workspace, result } = change(normalizeWorkspace(raw), raw);
    if (workspace) await persistSnapshot(tx, userId, workspace, normalizeWorkspace(raw));
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

const RECORD_TABLES = {
  projects: "mind_project", chats: "mind_chat", memories: "mind_memory", files: "mind_file",
  audit: "mind_audit", usage: "mind_usage", agents: "mind_agent", runs: "mind_agent_run",
  runEvents: "mind_agent_event", connections: "mind_connection", mailboxes: "mind_mailbox",
  schedules: "mind_schedule", deployments: "mind_deployment",
} as const;

async function persistSnapshot(sql: Sql, userId: string, ws: Workspace, before: Workspace): Promise<void> {
  const payload = JSON.stringify(ws);
  const changed = new Map<string, Set<string>>();
  for (const [key, table] of Object.entries(RECORD_TABLES)) {
    const collection = key as keyof typeof RECORD_TABLES;
    const old = new Map(before[collection].map((row) => [row.id, canonical(row)]));
    const next = new Map(ws[collection].map((row) => [row.id, canonical(row)]));
    changed.set(key, new Set([...next].filter(([id, body]) => old.get(id) !== body).map(([id]) => id)));
    for (const id of old.keys()) {
      if (!next.has(id)) await sql.query(`delete from ${table} where user_id = $1 and id = $2`, [userId, id]);
    }
  }
  for (const project of ws.projects) {
    if (!changed.get("projects")?.has(project.id)) continue;
    await sql`insert into mind_project (user_id, id, name, description, created_at) values (${userId}, ${project.id}, ${project.name}, ${project.description}, ${project.createdAt}) on conflict (user_id, id) do update set name = excluded.name, description = excluded.description, created_at = excluded.created_at`;
  }
  for (const chat of ws.chats) {
    if (!changed.get("chats")?.has(chat.id)) continue;
    await sql`insert into mind_chat (user_id, id, project_id, title, memory, autonomy, temporary, messages, retrieval_log) values (${userId}, ${chat.id}, ${chat.projectId}, ${chat.title}, ${chat.memory}, ${chat.autonomy}, ${chat.temporary}, ${JSON.stringify(chat.messages)}::jsonb, ${JSON.stringify(chat.retrievalLog)}::jsonb) on conflict (user_id, id) do update set project_id = excluded.project_id, title = excluded.title, memory = excluded.memory, autonomy = excluded.autonomy, temporary = excluded.temporary, messages = excluded.messages, retrieval_log = excluded.retrieval_log`;
  }
  for (const note of ws.memories) {
    if (!changed.get("memories")?.has(note.id)) continue;
    await sql`insert into mind_memory (user_id, id, scope, project_id, chat_id, body, source, archived, versions, created_at, updated_at) values (${userId}, ${note.id}, ${note.scope}, ${note.projectId}, ${note.chatId}, ${note.text}, ${note.source}, ${note.archived}, ${JSON.stringify(note.versions)}::jsonb, ${note.createdAt}, ${note.updatedAt}) on conflict (user_id, id) do update set scope = excluded.scope, project_id = excluded.project_id, chat_id = excluded.chat_id, body = excluded.body, source = excluded.source, archived = excluded.archived, versions = excluded.versions, created_at = excluded.created_at, updated_at = excluded.updated_at`;
  }
  for (const file of ws.files) {
    if (!changed.get("files")?.has(file.id)) continue;
    await sql`insert into mind_file (user_id, id, project_id, name, bytes, text_copy, created_at) values (${userId}, ${file.id}, ${file.projectId}, ${file.name}, ${file.bytes}, ${file.text}, ${file.createdAt}) on conflict (user_id, id) do update set project_id = excluded.project_id, name = excluded.name, bytes = excluded.bytes, text_copy = excluded.text_copy, created_at = excluded.created_at`;
  }
  for (const entry of ws.audit) {
    if (!changed.get("audit")?.has(entry.id)) continue;
    await sql`insert into mind_audit (user_id, id, at, action, target, result) values (${userId}, ${entry.id}, ${entry.at}, ${entry.action}, ${entry.target}, ${entry.result}) on conflict (user_id, id) do update set at = excluded.at, action = excluded.action, target = excluded.target, result = excluded.result`;
  }
  for (const entry of ws.usage) {
    if (!changed.get("usage")?.has(entry.id)) continue;
    await sql`insert into mind_usage (user_id, id, chat_id, at, model, request_id, prompt_tokens, completion_tokens) values (${userId}, ${entry.id}, ${entry.chatId}, ${entry.at}, ${entry.model}, ${entry.requestId}, ${entry.promptTokens}, ${entry.completionTokens}) on conflict (user_id, id) do update set chat_id = excluded.chat_id, at = excluded.at, model = excluded.model, request_id = excluded.request_id, prompt_tokens = excluded.prompt_tokens, completion_tokens = excluded.completion_tokens`;
  }
  for (const agent of ws.agents) {
    if (!changed.get("agents")?.has(agent.id)) continue;
    await sql`insert into mind_agent (user_id, id, name, version, body) values (${userId}, ${agent.id}, ${agent.name}, ${agent.version}, ${JSON.stringify(agent)}::jsonb) on conflict (user_id, id) do update set name = excluded.name, version = excluded.version, body = excluded.body`;
  }
  for (const run of ws.runs) {
    if (!changed.get("runs")?.has(run.id)) continue;
    await sql`insert into mind_agent_run (user_id, id, agent_id, parent_id, state, body) values (${userId}, ${run.id}, ${run.agentId}, ${run.parentId}, ${run.state}, ${JSON.stringify(run)}::jsonb) on conflict (user_id, id) do update set agent_id = excluded.agent_id, parent_id = excluded.parent_id, state = excluded.state, body = excluded.body`;
  }
  for (const event of ws.runEvents) {
    if (!changed.get("runEvents")?.has(event.id)) continue;
    await sql`insert into mind_agent_event (user_id, id, run_id, at, kind, detail) values (${userId}, ${event.id}, ${event.runId}, ${event.at}, ${event.kind}, ${event.detail}) on conflict (user_id, id) do update set run_id = excluded.run_id, at = excluded.at, kind = excluded.kind, detail = excluded.detail`;
  }
  for (const connection of ws.connections) {
    if (!changed.get("connections")?.has(connection.id)) continue;
    await sql`insert into mind_connection (user_id, id, provider, label, status) values (${userId}, ${connection.id}, ${connection.provider}, ${connection.label}, ${connection.status}) on conflict (user_id, id) do update set provider = excluded.provider, label = excluded.label, status = excluded.status`;
  }
  for (const mailbox of ws.mailboxes) {
    if (!changed.get("mailboxes")?.has(mailbox.id)) continue;
    await sql`insert into mind_mailbox (user_id, id, label, address, status) values (${userId}, ${mailbox.id}, ${mailbox.label}, ${mailbox.address}, ${mailbox.status}) on conflict (user_id, id) do update set label = excluded.label, address = excluded.address, status = excluded.status`;
  }
  for (const job of ws.schedules) {
    if (!changed.get("schedules")?.has(job.id)) continue;
    await sql`insert into mind_schedule (user_id, id, name, agent_id, next_run_at, enabled) values (${userId}, ${job.id}, ${job.name}, ${job.agentId}, ${job.nextRunAt}, ${job.enabled}) on conflict (user_id, id) do update set name = excluded.name, agent_id = excluded.agent_id, next_run_at = excluded.next_run_at, enabled = excluded.enabled`;
  }
  for (const deployment of ws.deployments) {
    if (!changed.get("deployments")?.has(deployment.id)) continue;
    await sql`insert into mind_deployment (user_id, id, agent_id, target, state) values (${userId}, ${deployment.id}, ${deployment.agentId}, ${deployment.target}, ${deployment.state}) on conflict (user_id, id) do update set agent_id = excluded.agent_id, target = excluded.target, state = excluded.state`;
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
