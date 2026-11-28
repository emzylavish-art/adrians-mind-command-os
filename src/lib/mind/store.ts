import { createHash } from "node:crypto";
import type { Sql } from "../db";
import type { AgentRun, Workspace } from "./types";
import { applyWorkspaceDelta, workspaceJsonBytes } from "./workspace-delta.ts";

import { canonical, mergeChatDeletionState, mergeMemoryState, normalizeWorkspace } from "./workspace.ts";
import { applyWorkspaceChanges, validateWorkspaceChanges } from "./workspace-changes.ts";

const MAX_JSON = 1_500_000;

export function snapshotTooLarge(ws: Workspace): boolean {
  return workspaceJsonBytes(ws) > MAX_JSON;
}

async function withOwnerSnapshot<T>(sql: Sql, userId: string, fn: (tx: Sql, raw: unknown) => Promise<T>): Promise<T> {
  if (!sql.transaction) throw new Error("Atomic workspace persistence requires a transactional database adapter.");
  return sql.transaction(async (tx) => {
    // Create a lockable row even on the owner's first save. All snapshot writers use this lock.
    await tx`insert into mind_snapshot (user_id, payload, updated_at) values (${userId}, '{}'::jsonb, now()) on conflict (user_id) do nothing`;
    const rows = await tx<{ payload: unknown }>`select payload from mind_snapshot where user_id = ${userId} for update`;
    return fn(tx, parsedPayload(rows[0]?.payload));
  });
}

export function updateOwnerWorkspace<T>(sql: Sql, userId: string, change: (current: Workspace, raw: unknown, tx: Sql) => { workspace?: Workspace; result: T } | Promise<{ workspace?: Workspace; result: T }>): Promise<T> {
  return withOwnerSnapshot(sql, userId, async (tx, raw) => {
    const current = normalizeWorkspace(raw);
    const { workspace, result } = await change(current, raw, tx);
    if (workspace) await persistSnapshot(tx, userId, workspace, current);
    return result;
  });
}

export function snapshotRevision(workspace: unknown): string {
  return createHash("sha256").update(canonical(workspace ?? {})).digest("hex");
}

/** Browser snapshots cannot rewind server-issued approvals or external-operation receipts. */
export function preserveServerRunAuthority(current: AgentRun[], incoming: AgentRun[]): AgentRun[] {
  const stored = new Map(current.map(run => [run.id, run]));
  const terminalGrant = new Set(["consumed", "revoked", "expired", "superseded"]);
  const next: AgentRun[] = incoming.map(run => {
    const authority = stored.get(run.id);
    if (!authority) return { ...run, externalOperation: undefined, modelOperation: undefined };
    // Model claims are issued by the owner transaction. Client snapshots cannot
    // clear an in-flight claim, advance its step or forge a completion.
    if (authority.modelOperation && (authority.modelOperation.state !== "completed" || run.step < authority.step)) {
      return { ...authority, state: run.state === "canceled" || run.state === "paused" ? run.state : authority.state };
    }
    run = { ...run, modelOperation: authority.modelOperation };
    const retired = [...(authority.approvalHistory ?? []), ...(authority.pendingApproval && terminalGrant.has(authority.pendingApproval.state) ? [authority.pendingApproval] : [])];
    const retiredIds = new Set(retired.filter(grant => terminalGrant.has(grant.state)).map(grant => grant.id));
    const history = new Map([...(run.approvalHistory ?? []), ...retired].map(grant => [`${grant.id}:${grant.state}`, grant]));
    const pendingApproval = run.pendingApproval && !retiredIds.has(run.pendingApproval.id) ? run.pendingApproval : undefined;
    const operation = authority.externalOperation;
    if (!operation) return { ...run, externalOperation: undefined, approvedActions: [], pendingApproval, approvalHistory: [...history.values()].slice(-40) };
    const protectedState = operation.state === "dispatching" || operation.state === "unknown" || operation.state === "failed";
    const samePlan = canonical(run.plan) === canonical(authority.plan) && canonical(run.configuration) === canonical(authority.configuration) && run.goal === authority.goal;
    if (protectedState || !samePlan || run.step < authority.step) {
      return { ...authority, approvedActions: [], pendingApproval: authority.pendingApproval,
        state: run.state === "paused" || run.state === "canceled" ? run.state : authority.state,
      };
    }
    if (operation.state === "not_sent") {
      // A proven pre-dispatch refusal can be reviewed again, but a browser cannot
      // turn that receipt into completed work or advance past the unsent step.
      const state = authority.state !== "canceled" && authority.state !== "failed" && run.step === authority.step && ["queued", "waiting_approval", "paused", "canceled"].includes(run.state) ? run.state : authority.state;
      return { ...authority, state, updatedAt: run.updatedAt, approvedActions: [],
        pendingApproval: state !== "canceled" && state !== "failed" && pendingApproval?.stepId === operation.stepId ? pendingApproval : undefined,
        approvalHistory: [...history.values()].slice(-40),
      };
    }
    // A succeeded external step must survive later local steps without freezing
    // the run or preventing a fresh, separately reviewed external operation.
    const evidence = new Map([...(run.stepResults ?? []), ...(authority.stepResults ?? [])].map(result => [result.stepId, result]));
    const stepResults = [...evidence.values()].sort((a, b) => authority.plan.findIndex(step => step.id === a.stepId) - authority.plan.findIndex(step => step.id === b.stepId));
    const combined = stepResults.map(result => result.text).join("\n");
    const result = combined.length <= 4000 ? combined : combined.slice(0, 3972) + "\n[Result excerpt truncated]";
    return { ...run, externalOperation: operation, stepResults, result,
      approvedActions: [], pendingApproval: pendingApproval?.stepId === operation.stepId ? undefined : pendingApproval,
      approvalHistory: [...history.values()].slice(-40),
    };
  });
  const seen = new Set(next.map(run => run.id));
  // Explicit history removal uses its own owner transaction. A snapshot omission
  // cannot erase an operation, including an unresolved dispatch after a crash.
  for (const run of current) if (!seen.has(run.id) && (run.externalOperation || run.modelOperation)) next.push(run);
  return next;
}

export function writeSnapshot(sql: Sql, userId: string, ws: Workspace, expectedRevision?: string): Promise<string | null> {
  return updateOwnerWorkspace<string | null>(sql, userId, (current, raw) => {
    // An omitted revision only permits creating the first snapshot. Existing
    // data must be changed under an explicit revision or updateOwnerWorkspace.
    if (expectedRevision === undefined && raw && Object.keys(raw as object).length > 0) return { result: null };
    if (expectedRevision !== undefined && snapshotRevision(raw) !== expectedRevision) return { result: null };
    const incoming = normalizeWorkspace(ws);
    const workspace = { ...incoming, ...mergeMemoryState(current, incoming), ...mergeChatDeletionState(incoming, current), runs: preserveServerRunAuthority(current.runs, incoming.runs) };
    return { workspace, result: snapshotRevision(workspace) };
  });
}

const RECORD_TABLES = {
  projects: "mind_project", chats: "mind_chat", memories: "mind_memory", files: "mind_file",
  audit: "mind_audit", usage: "mind_usage", agents: "mind_agent", runs: "mind_agent_run",
  runEvents: "mind_agent_event", connections: "mind_connection", mailboxes: "mind_mailbox",
  schedules: "mind_schedule", deployments: "mind_deployment",
} as const;

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

/** Bounded resource changes can save after the aggregate compatibility snapshot grows beyond the bulk-copy limit. */
export function writeWorkspaceChanges(sql: Sql, userId: string, input: unknown, expectedRevision: string): Promise<string | null> {
  const parsed = validateWorkspaceChanges(input);
  if (!parsed.ok) return Promise.reject(new Error(parsed.error));
  if (!/^[a-f0-9]{64}$/.test(expectedRevision)) return Promise.reject(new Error("Load the server revision before saving resource changes."));
  return updateOwnerWorkspace<string | null>(sql, userId, (current, raw) => {
    if (snapshotRevision(raw) !== expectedRevision) return { result: null };
    const incoming = normalizeWorkspace(applyWorkspaceChanges(current, parsed.changes));
    const workspace = { ...incoming, ...mergeMemoryState(current, incoming), ...mergeChatDeletionState(incoming, current), runs: preserveServerRunAuthority(current.runs, incoming.runs) };
    return { workspace, result: snapshotRevision(workspace) };
  });
}

async function persistSnapshot(sql: Sql, userId: string, ws: Workspace, previous: Workspace): Promise<void> {
  const payload = JSON.stringify(ws);
  // Mirror only resources which changed. The snapshot stays the compatibility
  // record while unrelated rows, indexes and created-at values remain untouched.
  const tables = { projects: "mind_project", chats: "mind_chat", memories: "mind_memory", files: "mind_file", audit: "mind_audit", usage: "mind_usage", agents: "mind_agent", runs: "mind_agent_run", runEvents: "mind_agent_event", connections: "mind_connection", mailboxes: "mind_mailbox", schedules: "mind_schedule", deployments: "mind_deployment" } as const;
  const changed = {} as Record<keyof typeof tables, Set<string>>;
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    const before = new Map(previous[key].map((row) => [row.id, canonical(row)]));
    const after = new Map(ws[key].map((row) => [row.id, canonical(row)]));
    changed[key] = new Set([...after].filter(([id, value]) => before.get(id) !== value).map(([id]) => id));
    const removed = [...before.keys()].filter((id) => !after.has(id));
    if (removed.length) await sql.query(`delete from ${tables[key]} where user_id = $1 and id = any($2::text[])`, [userId, removed]);
  }
  for (const project of ws.projects.filter((row) => changed.projects.has(row.id))) {
    await sql`insert into mind_project (user_id, id, name, description, created_at) values (${userId}, ${project.id}, ${project.name}, ${project.description}, ${project.createdAt}) on conflict (user_id, id) do update set name = excluded.name, description = excluded.description, created_at = excluded.created_at`;
  }
  for (const chat of ws.chats.filter((row) => changed.chats.has(row.id))) {
    await sql`insert into mind_chat (user_id, id, project_id, title, memory, autonomy, temporary, messages, retrieval_log) values (${userId}, ${chat.id}, ${chat.projectId}, ${chat.title}, ${chat.memory}, ${chat.autonomy}, ${chat.temporary}, ${JSON.stringify(chat.messages)}::jsonb, ${JSON.stringify(chat.retrievalLog)}::jsonb) on conflict (user_id, id) do update set project_id = excluded.project_id, title = excluded.title, memory = excluded.memory, autonomy = excluded.autonomy, temporary = excluded.temporary, messages = excluded.messages, retrieval_log = excluded.retrieval_log`;
  }
  for (const note of ws.memories.filter((row) => changed.memories.has(row.id))) {
    await sql`insert into mind_memory (user_id, id, scope, project_id, chat_id, body, source, archived, versions, created_at, updated_at) values (${userId}, ${note.id}, ${note.scope}, ${note.projectId}, ${note.chatId}, ${note.text}, ${note.source}, ${note.archived}, ${JSON.stringify(note.versions)}::jsonb, ${note.createdAt}, ${note.updatedAt}) on conflict (user_id, id) do update set scope = excluded.scope, project_id = excluded.project_id, chat_id = excluded.chat_id, body = excluded.body, source = excluded.source, archived = excluded.archived, versions = excluded.versions, created_at = excluded.created_at, updated_at = excluded.updated_at`;
  }
  for (const file of ws.files.filter((row) => changed.files.has(row.id))) {
    await sql`insert into mind_file (user_id, id, project_id, name, bytes, text_copy, created_at) values (${userId}, ${file.id}, ${file.projectId}, ${file.name}, ${file.bytes}, ${file.text}, ${file.createdAt}) on conflict (user_id, id) do update set project_id = excluded.project_id, name = excluded.name, bytes = excluded.bytes, text_copy = excluded.text_copy, created_at = excluded.created_at`;
  }
  for (const entry of ws.audit.filter((row) => changed.audit.has(row.id))) {
    await sql`insert into mind_audit (user_id, id, at, action, target, result) values (${userId}, ${entry.id}, ${entry.at}, ${entry.action}, ${entry.target}, ${entry.result}) on conflict (user_id, id) do update set at = excluded.at, action = excluded.action, target = excluded.target, result = excluded.result`;
  }
  for (const entry of ws.usage.filter((row) => changed.usage.has(row.id))) {
    await sql`insert into mind_usage (user_id, id, chat_id, at, model, request_id, prompt_tokens, completion_tokens) values (${userId}, ${entry.id}, ${entry.chatId}, ${entry.at}, ${entry.model}, ${entry.requestId}, ${entry.promptTokens}, ${entry.completionTokens}) on conflict (user_id, id) do update set chat_id = excluded.chat_id, at = excluded.at, model = excluded.model, request_id = excluded.request_id, prompt_tokens = excluded.prompt_tokens, completion_tokens = excluded.completion_tokens`;
  }
  for (const agent of ws.agents.filter((row) => changed.agents.has(row.id))) {
    await sql`insert into mind_agent (user_id, id, name, version, body) values (${userId}, ${agent.id}, ${agent.name}, ${agent.version}, ${JSON.stringify(agent)}::jsonb) on conflict (user_id, id) do update set name = excluded.name, version = excluded.version, body = excluded.body`;
  }
  for (const run of ws.runs.filter((row) => changed.runs.has(row.id))) {
    await sql`insert into mind_agent_run (user_id, id, agent_id, parent_id, state, body) values (${userId}, ${run.id}, ${run.agentId}, ${run.parentId}, ${run.state}, ${JSON.stringify(run)}::jsonb) on conflict (user_id, id) do update set agent_id = excluded.agent_id, parent_id = excluded.parent_id, state = excluded.state, body = excluded.body`;
  }
  for (const event of ws.runEvents.filter((row) => changed.runEvents.has(row.id))) {
    await sql`insert into mind_agent_event (user_id, id, run_id, at, kind, detail) values (${userId}, ${event.id}, ${event.runId}, ${event.at}, ${event.kind}, ${event.detail}) on conflict (user_id, id) do update set run_id = excluded.run_id, at = excluded.at, kind = excluded.kind, detail = excluded.detail`;
  }
  for (const connection of ws.connections.filter((row) => changed.connections.has(row.id))) {
    await sql`insert into mind_connection (user_id, id, provider, label, status) values (${userId}, ${connection.id}, ${connection.provider}, ${connection.label}, ${connection.status}) on conflict (user_id, id) do update set provider = excluded.provider, label = excluded.label, status = excluded.status`;
  }
  for (const mailbox of ws.mailboxes.filter((row) => changed.mailboxes.has(row.id))) {
    await sql`insert into mind_mailbox (user_id, id, label, address, status) values (${userId}, ${mailbox.id}, ${mailbox.label}, ${mailbox.address}, ${mailbox.status}) on conflict (user_id, id) do update set label = excluded.label, address = excluded.address, status = excluded.status`;
  }
  for (const job of ws.schedules.filter((row) => changed.schedules.has(row.id))) {
    await sql`insert into mind_schedule (user_id, id, name, agent_id, next_run_at, enabled) values (${userId}, ${job.id}, ${job.name}, ${job.agentId}, ${job.nextRunAt}, ${job.enabled}) on conflict (user_id, id) do update set name = excluded.name, agent_id = excluded.agent_id, next_run_at = excluded.next_run_at, enabled = excluded.enabled`;
  }
  for (const deployment of ws.deployments.filter((row) => changed.deployments.has(row.id))) {
    await sql`insert into mind_deployment (user_id, id, agent_id, target, state) values (${userId}, ${deployment.id}, ${deployment.agentId}, ${deployment.target}, ${deployment.state}) on conflict (user_id, id) do update set agent_id = excluded.agent_id, target = excluded.target, state = excluded.state`;
  }
  await sql`insert into mind_snapshot (user_id, payload, updated_at) values (${userId}, ${payload}::jsonb, now()) on conflict (user_id) do update set payload = excluded.payload, updated_at = now()`;
}

export async function readSnapshot(sql: Sql, userId: string): Promise<unknown | null> {
  const rows = await sql<{ payload: unknown }>`select payload from mind_snapshot where user_id = ${userId}`;
  return parsedPayload(rows[0]?.payload);
}

export function parsedPayload(payload: unknown): unknown {
  return typeof payload === "string" ? JSON.parse(payload) : payload ?? null;
}

export async function writeControl(sql: Sql, userId: string, halted: boolean): Promise<void> {
  await sql`insert into mind_control (user_id, halted, updated_at) values (${userId}, ${halted}, now()) on conflict (user_id) do update set halted = excluded.halted, updated_at = now()`;
}

export async function readControl(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ halted: boolean }>`select halted from mind_control where user_id = ${userId}`;
  return rows[0]?.halted === true;
}

export async function listSnapshotOwnerPage(sql: Sql, options: { after?: string; limit?: number } = {}): Promise<{ ids: string[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 500) || 500));
  const rows = await sql<{ user_id: string }>`select user_id from mind_snapshot where user_id > ${options.after ?? ""} order by user_id asc limit ${limit + 1}`;
  const ids = rows.map((row) => row.user_id).filter((id) => typeof id === "string" && id.length > 0);
  return { ids: ids.slice(0, limit), nextCursor: ids.length > limit ? ids[limit - 1]! : null };
}

/** Compatibility collector; SQL pages are bounded and every owner is visited. */
export async function listSnapshotUserIds(sql: Sql): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await listSnapshotOwnerPage(sql, { after });
    ids.push(...page.ids);
    if (!page.nextCursor) return ids;
    if (after && page.nextCursor <= after) throw new Error("Workspace owner pagination did not advance.");
    after = page.nextCursor;
  }
}
