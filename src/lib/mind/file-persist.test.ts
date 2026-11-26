import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "../../../scripts/migration-plan.mjs";
import type { Sql } from "../db.ts";
import { applyAgentTurn } from "./agent-session.ts";
import { safeToResume, voiceProviderStatus } from "./memory/index.ts";
import type { AgentTool } from "./orchestrator.ts";
import { readToolRuns, writeToolRun } from "./notion-record.ts";
import { readSnapshot, writeSnapshot } from "./store.ts";
import { addMemory, emptyWorkspace, normalizeWorkspace, reviseMemory } from "./workspace.ts";

function toSql(pg: PGlite): Sql {
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0] ?? "";
    for (let index = 0; index < values.length; index += 1) text += `$${index + 1}${strings[index + 1] ?? ""}`;
    const result = await pg.query(text, values);
    return result.rows;
  }) as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as T[];
  return sql;
}

async function openDatabase(dataDir: string) {
  const pg = new PGlite({ dataDir, initialMemory: 128 * 1024 * 1024, postgresqlconf: ["shared_buffers=8MB", "work_mem=1MB"] });
  await pg.waitReady;
  await pg.exec("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  const names = readdirSync(join(process.cwd(), "migrations"));
  const files: Record<string, string> = {};
  for (const name of names) {
    if (name.endsWith(".sql")) files[name] = readFileSync(join(process.cwd(), "migrations", name), "utf8");
  }
  const done = (await pg.query<{ name: string }>("select name from _migrations")).rows.map((row) => row.name);
  for (const { name, path } of pendingMigrations(Object.keys(files), done)) {
    await pg.exec("begin");
    await pg.exec(files[path] ?? files[name] ?? "");
    await pg.query("insert into _migrations (name) values ($1)", [name]);
    await pg.exec("commit");
  }
  return pg;
}

const projects: AgentTool = { id: "list_projects", confirm: false, available: true, unavailableReason: "", run: () => ({ ok: true, text: "Harbor" }) };
const due: AgentTool = { id: "run_due_schedules", confirm: true, available: true, unavailableReason: "", run: () => ({ ok: true, text: "queued" }) };

describe("file database", () => {
  it("keeps the conversation after the database file is closed and reopened", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-db-"));
    try {
      const first = await openDatabase(dir);
      const ws = addMemory(emptyWorkspace(), { scope: "global", text: "The pier depth is 12 feet.", source: "owner", projectId: null, chatId: null });
      ws.projects.push({ id: "p1", name: "Harbor", description: "", createdAt: "2026-04-01T00:00:00.000Z" });
      const applied = applyAgentTurn(ws, {
        chatId: "chat-1",
        text: "What is the pier depth?",
        modality: "chat",
        tools: [projects],
        toolId: "list_projects",
        now: "2026-04-01T12:00:00.000Z",
        memory: "on",
        memories: ws.memories,
        complete: (prompt) => {
          assert.match(prompt, /pier depth is 12 feet/);
          assert.match(prompt, /Harbor/);
          return { ok: true, text: "The saved note says the pier depth is 12 feet." };
        },
      });
      const waiting = applyAgentTurn(applied.ws, {
        chatId: "chat-1",
        text: "run due schedules",
        modality: "voice",
        tools: [due],
        toolId: "run_due_schedules",
        now: "2026-04-01T12:01:00.000Z",
      });
      assert.equal(waiting.status, "awaiting_confirmation");
      assert.equal(safeToResume(waiting.ws.audit, "run_due_schedules", "2026-04-01T12:01:00.000Z"), true);
      const corrected = reviseMemory(waiting.ws, waiting.ws.memories[0]!.id, "The pier depth is 14 feet.");
      await writeSnapshot(toSql(first), "owner-a", corrected);
      if (applied.run) await writeToolRun(toSql(first), "owner-a", applied.run);
      await first.close();

      const second = await openDatabase(dir);
      const loaded = normalizeWorkspace(await readSnapshot(toSql(second), "owner-a"));
      assert.equal(loaded.chats[0]?.messages[1]?.content, "The saved note says the pier depth is 12 feet.");
      assert.match(loaded.memories[0]?.text ?? "", /14 feet/);
      assert.equal(loaded.audit.some((entry) => entry.action === "awaiting_confirmation"), true);
      assert.equal((await readToolRuns(toSql(second), "owner-a")).length, 1);
      assert.equal(await readSnapshot(toSql(second), "owner-b"), null);
      assert.equal((await readToolRuns(toSql(second), "owner-b")).length, 0);
      const done = {
        ...loaded,
        audit: [{ id: "done", at: "2026-04-01T12:02:00.000Z", action: "agent_turn", target: "run_due_schedules", result: "chat completed" }, ...loaded.audit],
      };
      assert.equal(safeToResume(done.audit, "run_due_schedules", "2026-04-01T12:01:00.000Z"), false);
      const noteBefore = loaded.memories.map((item) => item.text).join("\n");
      const later = applyAgentTurn(loaded, {
        chatId: "chat-2",
        text: "What is the pier depth?",
        modality: "voice",
        tools: [projects],
        toolId: "list_projects",
        now: "2026-04-01T13:00:00.000Z",
        memory: "on",
        memories: loaded.memories,
        complete: (prompt) => {
          assert.match(prompt, /14 feet/);
          assert.doesNotMatch(prompt, /12 feet/);
          return { ok: true, text: "The saved note says the pier depth is 14 feet." };
        },
      });
      assert.equal(later.ws.memories.map((item) => item.text).join("\n"), noteBefore);
      const forgotten = { ...later.ws, memories: later.ws.memories.map((item) => ({ ...item, archived: true })) };
      const afterDelete = applyAgentTurn(forgotten, {
        chatId: "chat-3",
        text: "What is the pier depth?",
        modality: "chat",
        tools: [projects],
        toolId: "list_projects",
        now: "2026-04-01T13:05:00.000Z",
        memory: "on",
        memories: forgotten.memories,
        complete: (prompt) => {
          assert.doesNotMatch(prompt, /Remembered/);
          return { ok: true, text: "No saved note was used." };
        },
      });
      assert.equal(afterDelete.ws.memories[0]?.archived, true);
      await writeSnapshot(toSql(second), "owner-a", afterDelete.ws);
      await second.close();
      const third = await openDatabase(dir);
      const again = normalizeWorkspace(await readSnapshot(toSql(third), "owner-a"));
      assert.equal(again.chats.find((chat) => chat.id === "chat-2")?.messages.at(-1)?.content, "The saved note says the pier depth is 14 feet.");
      assert.equal(again.memories[0]?.archived, true);
      assert.equal(await readSnapshot(toSql(third), "owner-b"), null);
      await third.close();
      assert.equal(voiceProviderStatus(undefined).realtime, false);
      assert.match(voiceProviderStatus(undefined).output, /Nothing is spoken/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it("C2/AA-134 keeps execution receipts, deletion records and control state across isolated database reopen", async () => {
  const { addAgentFromTemplate, addSchedule, runDueSchedules } = await import("./fleet.ts");
  const { readControl, writeControl, snapshotRevision } = await import("./store.ts");
  const dir = mkdtempSync(join(tmpdir(), "mind-c2-recovery-"));
  let database: PGlite | undefined;
  try {
    database = await openDatabase(dir);
    const made = addAgentFromTemplate(emptyWorkspace(), "Coding", "2026-11-25T12:00:00.000Z");
    if (!made.ok) throw new Error(made.error);
    const schedule = addSchedule(made.ws, "Recovery fixture", made.agent.id, 60, "2026-11-25T12:00:00.000Z");
    if (!schedule.ok) throw new Error(schedule.error);
    const ws = runDueSchedules(schedule.ws, "2026-11-25T12:00:00.000Z");
    ws.deletedMemoryIds = ["removed-note"];
    ws.deletedFileIds = ["removed-file"];
    const savedRevision = await writeSnapshot(toSql(database), "c2-owner", ws);
    await writeControl(toSql(database), "c2-owner", true);
    await database.close();
    database = undefined;
    database = await openDatabase(dir);
    const raw = await readSnapshot(toSql(database), "c2-owner");
    assert.equal(snapshotRevision(raw), savedRevision);
    const restored = normalizeWorkspace(raw);
    assert.deepEqual(restored.deletedMemoryIds, ["removed-note"]);
    assert.deepEqual(restored.deletedFileIds, ["removed-file"]);
    assert.equal(restored.schedules[0]?.occurrences?.[0]?.runId, restored.runs[0]?.id);
    assert.equal(restored.runs[0]?.plan[0]?.tool, "list_projects");
    assert.equal(await readControl(toSql(database), "c2-owner"), true);
    assert.equal(await readControl(toSql(database), "another-owner"), false);
    assert.equal(await readSnapshot(toSql(database), "another-owner"), null);
    const rejected = await writeSnapshot(toSql(database), "c2-owner", emptyWorkspace(), "0".repeat(64));
    assert.equal(rejected, null);
    assert.equal(snapshotRevision(await readSnapshot(toSql(database), "c2-owner")), savedRevision);
  } finally {
    if (database) await database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
