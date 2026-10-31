import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "../../../scripts/migration-plan.mjs";
import type { Sql } from "../db.ts";
import { applyAgentTurn } from "./agent-session.ts";
import { safeToResume, voiceProviderStatus } from "./memory.ts";
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
  const pg = new PGlite({ dataDir });
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
      let ws = addMemory(emptyWorkspace(), { scope: "global", text: "The pier depth is 12 feet.", source: "owner", projectId: null, chatId: null });
      ws.projects.push({ id: "p1", name: "Harbor", description: "", createdAt: "2026-04-01T00:00:00.000Z" });
      const applied = applyAgentTurn(ws, {
        chatId: "chat-1",
        text: "What is the pier depth?",
        modality: "chat",
        tools: [projects],
        toolId: "list_projects",
        now: "2026-04-01T12:00:00.000Z",
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
      await second.close();
      assert.equal(voiceProviderStatus(undefined).realtime, false);
      assert.match(voiceProviderStatus(undefined).output, /Nothing is spoken/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
