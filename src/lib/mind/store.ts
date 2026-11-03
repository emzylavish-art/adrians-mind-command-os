import type { Sql } from "../db";
import type { Workspace } from "./types";

const MAX_JSON = 1_500_000;

export function snapshotTooLarge(ws: Workspace): boolean {
  return JSON.stringify(ws).length > MAX_JSON;
}

export async function writeSnapshot(sql: Sql, userId: string, ws: Workspace): Promise<void> {
  const payload = JSON.stringify(ws);
  // Reject oversized workspaces before any destructive materialized-table update.
  if (payload.length > MAX_JSON) throw new RangeError("Workspace snapshot exceeds the maximum supported size.");
  const writeRows = async (tx: Sql): Promise<void> => {
    await tx`delete from mind_project where user_id = ${userId}`;
    await tx`delete from mind_chat where user_id = ${userId}`;
    await tx`delete from mind_memory where user_id = ${userId}`;
    await tx`delete from mind_file where user_id = ${userId}`;
    await tx`delete from mind_audit where user_id = ${userId}`;
    await tx`delete from mind_usage where user_id = ${userId}`;
    await tx`delete from mind_agent where user_id = ${userId}`;
    await tx`delete from mind_agent_run where user_id = ${userId}`;
    await tx`delete from mind_agent_event where user_id = ${userId}`;
    await tx`delete from mind_connection where user_id = ${userId}`;
    await tx`delete from mind_mailbox where user_id = ${userId}`;
    await tx`delete from mind_schedule where user_id = ${userId}`;
    await tx`delete from mind_deployment where user_id = ${userId}`;
    for (const project of ws.projects) {
      await tx`insert into mind_project (user_id, id, name, description, created_at) values (${userId}, ${project.id}, ${project.name}, ${project.description}, ${project.createdAt})`;
    }
    for (const chat of ws.chats) {
      await tx`insert into mind_chat (user_id, id, project_id, title, memory, autonomy, temporary, messages, retrieval_log) values (${userId}, ${chat.id}, ${chat.projectId}, ${chat.title}, ${chat.memory}, ${chat.autonomy}, ${chat.temporary}, ${JSON.stringify(chat.messages)}::jsonb, ${JSON.stringify(chat.retrievalLog)}::jsonb)`;
    }
    for (const note of ws.memories) {
      await tx`insert into mind_memory (user_id, id, scope, project_id, chat_id, body, source, archived, versions, created_at, updated_at) values (${userId}, ${note.id}, ${note.scope}, ${note.projectId}, ${note.chatId}, ${note.text}, ${note.source}, ${note.archived}, ${JSON.stringify(note.versions)}::jsonb, ${note.createdAt}, ${note.updatedAt})`;
    }
    for (const file of ws.files) {
      await tx`insert into mind_file (user_id, id, project_id, name, bytes, text_copy, created_at) values (${userId}, ${file.id}, ${file.projectId}, ${file.name}, ${file.bytes}, ${file.text}, ${file.createdAt})`;
    }
    for (const entry of ws.audit) {
      await tx`insert into mind_audit (user_id, id, at, action, target, result) values (${userId}, ${entry.id}, ${entry.at}, ${entry.action}, ${entry.target}, ${entry.result})`;
    }
    for (const entry of ws.usage) {
      await tx`insert into mind_usage (user_id, id, chat_id, at, model, request_id, prompt_tokens, completion_tokens) values (${userId}, ${entry.id}, ${entry.chatId}, ${entry.at}, ${entry.model}, ${entry.requestId}, ${entry.promptTokens}, ${entry.completionTokens})`;
    }
    for (const agent of ws.agents) {
      await tx`insert into mind_agent (user_id, id, name, version, body) values (${userId}, ${agent.id}, ${agent.name}, ${agent.version}, ${JSON.stringify(agent)}::jsonb)`;
    }
    for (const run of ws.runs) {
      await tx`insert into mind_agent_run (user_id, id, agent_id, parent_id, state, body) values (${userId}, ${run.id}, ${run.agentId}, ${run.parentId}, ${run.state}, ${JSON.stringify(run)}::jsonb)`;
    }
    for (const event of ws.runEvents) {
      await tx`insert into mind_agent_event (user_id, id, run_id, at, kind, detail) values (${userId}, ${event.id}, ${event.runId}, ${event.at}, ${event.kind}, ${event.detail})`;
    }
    for (const connection of ws.connections) {
      await tx`insert into mind_connection (user_id, id, provider, label, status) values (${userId}, ${connection.id}, ${connection.provider}, ${connection.label}, ${connection.status})`;
    }
    for (const mailbox of ws.mailboxes) {
      await tx`insert into mind_mailbox (user_id, id, label, address, status) values (${userId}, ${mailbox.id}, ${mailbox.label}, ${mailbox.address}, ${mailbox.status})`;
    }
    for (const job of ws.schedules) {
      await tx`insert into mind_schedule (user_id, id, name, agent_id, next_run_at, enabled) values (${userId}, ${job.id}, ${job.name}, ${job.agentId}, ${job.nextRunAt}, ${job.enabled})`;
    }
    for (const deployment of ws.deployments) {
      await tx`insert into mind_deployment (user_id, id, agent_id, target, state) values (${userId}, ${deployment.id}, ${deployment.agentId}, ${deployment.target}, ${deployment.state})`;
    }
    await tx`insert into mind_snapshot (user_id, payload, updated_at) values (${userId}, ${payload}::jsonb, now()) on conflict (user_id) do update set payload = excluded.payload, updated_at = now()`;
  };
  // Production clients provide transactions. The fallback supports lightweight
  // in-memory mocks used by existing unit tests.
  if (sql.transaction) await sql.transaction(writeRows);
  else await writeRows(sql);
}

export async function readSnapshot(sql: Sql, userId: string): Promise<unknown | null> {
  const rows = await sql<{ payload: unknown }>`select payload from mind_snapshot where user_id = ${userId}`;
  const payload = rows[0]?.payload;
  if (!payload) return null;
  return typeof payload === "string" ? JSON.parse(payload) : payload;
}

export async function writeControl(sql: Sql, userId: string, halted: boolean): Promise<void> {
  await sql`insert into mind_control (user_id, halted, updated_at) values (${userId}, ${halted}, now()) on conflict (user_id) do update set halted = excluded.halted, updated_at = now()`;
}

export async function readControl(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ halted: boolean }>`select halted from mind_control where user_id = ${userId}`;
  return rows[0]?.halted === true;
}
