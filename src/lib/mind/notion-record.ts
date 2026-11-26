import type { Sql } from "../db";
import type { ExecutionMetadata } from "./execution-ledger.ts";

export async function writeToolRun(sql: Sql, userId: string, run: { id: string; tool: string; action: string; ok: boolean; detail: string; metadata?: ExecutionMetadata }): Promise<void> {
  await sql`insert into mind_tool_run (user_id, id, tool, action, ok, detail, metadata) values (${userId}, ${run.id}, ${run.tool}, ${run.action}, ${run.ok}, ${run.detail.slice(0, 500)}, ${JSON.stringify(run.metadata ?? {})}::jsonb) on conflict (user_id, id) do nothing`;
}

export async function readToolRuns(sql: Sql, userId: string): Promise<{ id: string }[]> {
  return sql<{ id: string }>`select id from mind_tool_run where user_id = ${userId}`;
}
