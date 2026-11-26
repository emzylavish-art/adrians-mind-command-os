import type { Sql } from "../db.ts";
import type { ConsultExecutionReceipt } from "./model-consult.ts";

export async function saveModelExecution(sql: Sql, userId: string, receipt: ConsultExecutionReceipt): Promise<void> {
  // Repeat delivery reconciles the same execution; an uncertain update cannot
  // replace an already completed execution receipt.
  await sql`insert into mind_model_execution (user_id, execution_id, operation_id, payload)
    values (${userId}, ${receipt.executionId}, ${receipt.parentOperationId}, ${JSON.stringify(receipt)}::jsonb)
    on conflict (user_id, execution_id) do update set payload = excluded.payload
    where mind_model_execution.operation_id = excluded.operation_id
      and (mind_model_execution.payload->>'outcome' = 'unknown' or excluded.payload->>'outcome' = 'completed')`;
}

export async function readModelExecutions(sql: Sql, userId: string, operationId: string): Promise<ConsultExecutionReceipt[]> {
  const rows = await sql<{ payload: ConsultExecutionReceipt | string }>`select payload from mind_model_execution
    where user_id = ${userId} and operation_id = ${operationId} order by created_at, execution_id limit 100`;
  return rows.map((row) => typeof row.payload === "string" ? JSON.parse(row.payload) as ConsultExecutionReceipt : row.payload);
}
