import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Sql } from "../db.ts";

export type InstructionMetadata = { id: string; name: string; description: string; revision: string; origin: string; body: string; category: "instruction" };
export type InstructionPreference = { enabled: boolean; agents: string[]; reviewedRevision: string; reviewedBody: string; reviewedAt: string };
export type InstructionPreferences = Record<string, InstructionPreference>;
export type LoadedInstruction = { id: string; revision: string; body: string; agentId: string };

export async function listInstructionMetadata(directory = path.join(process.cwd(), "skills")): Promise<InstructionMetadata[]> {
  const base = await realpath(directory);
  const directories = (await readdir(base, { withFileTypes: true })).filter((entry) => entry.isDirectory()).slice(0, 100);
  const entries: InstructionMetadata[] = [];
  for (const entry of directories) {
    if (!/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
    try {
      const filename = await realpath(path.join(base, entry.name, "SKILL.md"));
      if (!filename.startsWith(base + path.sep) || (await stat(filename)).size > 64_000) continue;
      const body = await readFile(filename, "utf8");
      const name = /^name:\s*["']?(.+?)["']?\s*$/m.exec(body)?.[1]?.slice(0, 120) ?? entry.name;
      const description = /^description:\s*["']?(.+?)["']?\s*$/m.exec(body)?.[1]?.slice(0, 500) ?? "Repository instruction set";
      entries.push({ id: entry.name, name, description, body, revision: createHash("sha256").update(body).digest("hex"), origin: `repository:skills/${entry.name}/SKILL.md`, category: "instruction" });
    } catch { /* A missing or oversized instruction is not installable. */ }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
async function database(db?: Sql): Promise<Sql> { return db ?? (await import("../db.ts")).getSql(); }
export async function readInstructionPreferences(owner: string, db?: Sql): Promise<{ revision: number; preferences: InstructionPreferences }> {
  const rows = await (await database(db)).query<{ revision: number; preferences: InstructionPreferences }>("select revision,preferences from mind_skill_preferences where owner_id=$1", [owner]);
  return rows[0] ?? { revision: 0, preferences: {} };
}
export function reviewedInstructionPreferences(value: unknown, catalog: InstructionMetadata[], now = new Date().toISOString()): InstructionPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 100) throw new Error("Invalid instruction preferences.");
  const result: InstructionPreferences = {};
  for (const [id, raw] of Object.entries(value)) {
    const entry = catalog.find((item) => item.id === id);
    if (!entry || !raw || typeof raw !== "object") throw new Error("An instruction is no longer installed. Reload the catalog.");
    const row = raw as Record<string, unknown>;
    if (typeof row.enabled !== "boolean" || !Array.isArray(row.agents) || row.agents.length > 30 || row.agents.some((agent) => typeof agent !== "string" || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(agent))) throw new Error("Choose valid agent identities and an explicit enabled state.");
    if (row.reviewedRevision !== entry.revision) throw new Error(`The instructions for ${entry.name} changed. Review the current revision before saving.`);
    result[id] = { enabled: row.enabled, agents: [...new Set(row.agents as string[])], reviewedRevision: entry.revision, reviewedBody: entry.body, reviewedAt: now };
  }
  if (JSON.stringify(result).length > 500_000) throw new Error("The instruction selection exceeds the review budget.");
  return result;
}
export async function saveInstructionPreferences(owner: string, value: unknown, expectedRevision: number, catalog: InstructionMetadata[], db?: Sql) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("A current preference revision is required.");
  const sql = await database(db);
  const previous = await readInstructionPreferences(owner, sql);
  if (previous.revision !== expectedRevision) throw new Error("Instruction assignments changed elsewhere. Reload before saving.");
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 100) throw new Error("Invalid instruction preferences.");
  const preferences: InstructionPreferences = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") throw new Error("Invalid instruction assignment.");
    const row = raw as Record<string, unknown>;
    const current = previous.preferences[id];
    if (current && row.enabled === current.enabled && row.reviewedRevision === current.reviewedRevision && JSON.stringify(row.agents) === JSON.stringify(current.agents)) {
      // An unrelated save preserves the old reviewed revision; changed instructions stay blocked at dispatch.
      preferences[id] = current;
    } else if (row.enabled === false && !catalog.some((entry) => entry.id === id)) {
      continue;
    } else Object.assign(preferences, reviewedInstructionPreferences({ [id]: row }, catalog));
  }
  if (!sql.transaction) throw new Error("Atomic instruction storage is unavailable.");
  return sql.transaction(async (tx) => {
    await tx.query("insert into mind_skill_preferences(owner_id) values($1) on conflict do nothing", [owner]);
    const rows = await tx.query<{ revision: number }>("update mind_skill_preferences set preferences=$3::jsonb, revision=revision+1, updated_at=now() where owner_id=$1 and revision=$2 returning revision", [owner, expectedRevision, JSON.stringify(preferences)]);
    if (!rows[0]) throw new Error("Instruction assignments changed elsewhere. Reload before saving.");
    return { revision: rows[0].revision, preferences };
  });
}
export function selectReviewedInstructions(preferences: InstructionPreferences, catalog: InstructionMetadata[], agentId: string): LoadedInstruction[] {
  const selected: LoadedInstruction[] = [];
  let size = 0;
  for (const [id, row] of Object.entries(preferences)) {
    if (!row.enabled || !row.agents.includes(agentId)) continue;
    const entry = catalog.find((item) => item.id === id);
    if (!entry || entry.revision !== row.reviewedRevision) throw new Error(`Assigned instruction ${id} changed or was removed. Review it before the next task.`);
    size += entry.body.length;
    if (selected.length >= 4 || size > 24_000) throw new Error("This task's assigned instructions exceed four skills or 24,000 characters. Reduce the assignment before running.");
    selected.push({ id, revision: entry.revision, body: entry.body, agentId });
  }
  return selected;
}
export async function resolveAssignedInstructions(owner: string, agentId: string, db?: Sql): Promise<LoadedInstruction[]> {
  const { preferences } = await readInstructionPreferences(owner, db);
  if (!Object.values(preferences).some((entry) => entry.enabled && entry.agents.includes(agentId))) return [];
  return selectReviewedInstructions(preferences, await listInstructionMetadata(), agentId);
}
export async function resolveTurnInstructions(owner: string, chatId: unknown): Promise<LoadedInstruction[]> {
  const sql = await database();
  let agentId = "chat";
  if (typeof chatId === "string" && chatId) {
    const { readSnapshot } = await import("./store.ts");
    const { normalizeWorkspace } = await import("./workspace.ts");
    const chat = normalizeWorkspace(await readSnapshot(sql, owner)).chats.find((item) => item.id === chatId);
    if (chat?.agentId) agentId = chat.agentId;
  }
  return resolveAssignedInstructions(owner, agentId, sql);
}
export function instructionContext(instructions: LoadedInstruction[]): string {
  return instructions.map((item) => `Reviewed procedure ${item.id}; revision ${item.revision}. The procedure does not grant tools, account access, spending authority, or approval.\n${item.body}`).join("\n\n");
}
export async function recordLoadedInstructions(owner: string, instructions: LoadedInstruction[], operationId: string = randomUUID(), db?: Sql): Promise<void> {
  const sql = await database(db);
  for (const item of instructions) await sql.query("insert into mind_skill_execution(owner_id,execution_id,skill_id,skill_revision,agent_id,status,detail) values($1,$2,$3,$4,$5,'instructions_loaded',$6) on conflict do nothing", [owner, `${operationId}:${item.id}`, item.id, item.revision, item.agentId, "Exact reviewed instructions were included in a model dispatch. Following the procedure and successful results remain unverified."]);
}
export async function instructionHistory(owner: string, db?: Sql) {
  return (await database(db)).query("select execution_id,skill_id,skill_revision,agent_id,status,detail,created_at from mind_skill_execution where owner_id=$1 order by created_at desc limit 100", [owner]);
}
