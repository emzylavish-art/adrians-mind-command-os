import type { Sql } from "../db";
import type { Workspace } from "./types";

const MAX_JSON = 1_500_000;

export function snapshotTooLarge(ws: Workspace): boolean {
  return JSON.stringify(ws).length > MAX_JSON;
}

export async function writeSnapshot(sql: Sql, userId: string, ws: Workspace): Promise<void> {
  const payload = JSON.stringify(ws);
  await sql`delete from mind_project where user_id = ${userId}`;
  await sql`delete from mind_chat where user_id = ${userId}`;
  await sql`delete from mind_memory where user_id = ${userId}`;
  await sql`delete from mind_file where user_id = ${userId}`;
  await sql`delete from mind_audit where user_id = ${userId}`;
  await sql`delete from mind_usage where user_id = ${userId}`;
  for (const project of ws.projects) {
    await sql`insert into mind_project (user_id, id, name, description, created_at) values (${userId}, ${project.id}, ${project.name}, ${project.description}, ${project.createdAt})`;
  }
  for (const chat of ws.chats) {
    await sql`insert into mind_chat (user_id, id, project_id, title, memory, autonomy, temporary, messages, retrieval_log) values (${userId}, ${chat.id}, ${chat.projectId}, ${chat.title}, ${chat.memory}, ${chat.autonomy}, ${chat.temporary}, ${JSON.stringify(chat.messages)}::jsonb, ${JSON.stringify(chat.retrievalLog)}::jsonb)`;
  }
  for (const note of ws.memories) {
    await sql`insert into mind_memory (user_id, id, scope, project_id, chat_id, body, source, archived, versions, created_at, updated_at) values (${userId}, ${note.id}, ${note.scope}, ${note.projectId}, ${note.chatId}, ${note.text}, ${note.source}, ${note.archived}, ${JSON.stringify(note.versions)}::jsonb, ${note.createdAt}, ${note.updatedAt})`;
  }
  for (const file of ws.files) {
    await sql`insert into mind_file (user_id, id, project_id, name, bytes, text_copy, created_at) values (${userId}, ${file.id}, ${file.projectId}, ${file.name}, ${file.bytes}, ${file.text}, ${file.createdAt})`;
  }
  for (const entry of ws.audit) {
    await sql`insert into mind_audit (user_id, id, at, action, target, result) values (${userId}, ${entry.id}, ${entry.at}, ${entry.action}, ${entry.target}, ${entry.result})`;
  }
  for (const entry of ws.usage) {
    await sql`insert into mind_usage (user_id, id, chat_id, at, model, request_id, prompt_tokens, completion_tokens) values (${userId}, ${entry.id}, ${entry.chatId}, ${entry.at}, ${entry.model}, ${entry.requestId}, ${entry.promptTokens}, ${entry.completionTokens})`;
  }
  await sql`insert into mind_snapshot (user_id, payload, updated_at) values (${userId}, ${payload}::jsonb, now()) on conflict (user_id) do update set payload = excluded.payload, updated_at = now()`;
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
