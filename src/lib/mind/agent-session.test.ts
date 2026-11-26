import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sql } from "../db.ts";
import { applyAgentTurn } from "./agent-session.ts";
import type { AgentTool } from "./orchestrator.ts";
import { readSnapshot, snapshotRevision, writeSnapshot } from "./store.ts";
import { readToolRuns, writeToolRun } from "./notion-record.ts";
import { normalizeWorkspace, emptyWorkspace } from "./workspace.ts";

function db() {
  const snaps = new Map<string, string>();
  const runs: { user_id: string; id: string; detail: string }[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    if (text.includes("insert into mind_snapshot") && (!text.includes("do nothing") || !snaps.has(String(values[0])))) snaps.set(String(values[0]), String(values[1] ?? "{}"));
    if (text.includes("insert into mind_tool_run")) runs.push({ user_id: String(values[0]), id: String(values[1]), detail: String(values[5]) });
    if (text.includes("select payload")) {
      const payload = snaps.get(String(values[0]));
      return payload ? [{ payload }] : [];
    }
    if (text.includes("select id from mind_tool_run")) return runs.filter((run) => run.user_id === values[0]).map((run) => ({ id: run.id }));
    return [];
  }) as Sql;
  sql.query = async () => [];
  sql.transaction = async (fn) => fn(sql);
  return { sql, runs };
}

const projects: AgentTool = {
  id: "list_projects",
  confirm: false,
  available: true,
  unavailableReason: "",
  run: () => ({ ok: true, text: "Harbor" }),
};

describe("agent session reload", () => {
  it("stores the tool result, the model reply, and reloads them for the same owner", async () => {
    const { sql, runs } = db();
    const start = emptyWorkspace();
    start.projects.push({ id: "p1", name: "Harbor", description: "", createdAt: "2026-04-01T00:00:00.000Z" });
    const applied = applyAgentTurn(start, {
      chatId: "chat-1",
      text: "show my projects",
      modality: "chat",
      tools: [projects],
      toolId: "list_projects",
      now: "2026-04-01T12:00:00.000Z",
      complete: (prompt) => {
        assert.match(prompt, /Harbor/);
        return { ok: true, text: "The saved project is Harbor." };
      },
    });
    assert.equal(applied.finalText, "The saved project is Harbor.");
    assert.equal(applied.run?.tool, "list_projects");
    assert.equal(applied.run?.detail, "Harbor");
    await writeSnapshot(sql, "owner-a", applied.ws);
    if (applied.run) await writeToolRun(sql, "owner-a", applied.run);
    const voice = applyAgentTurn(applied.ws, {
      chatId: "chat-1",
      text: "show my projects again",
      modality: "voice",
      tools: [projects],
      toolId: "list_projects",
      now: "2026-04-01T12:05:00.000Z",
    });
    await writeSnapshot(sql, "owner-a", voice.ws, snapshotRevision(await readSnapshot(sql, "owner-a")));
    if (voice.run) await writeToolRun(sql, "owner-a", voice.run);
    const loaded = normalizeWorkspace(await readSnapshot(sql, "owner-a"));
    assert.equal(loaded.chats[0]?.messages.at(-1)?.content, "Harbor");
    assert.equal(loaded.chats[0]?.messages[1]?.content, "The saved project is Harbor.");
    assert.equal(loaded.audit.some((entry) => entry.result.startsWith("voice")), true);
    const own = await readToolRuns(sql, "owner-a");
    const other = await readToolRuns(sql, "owner-b");
    assert.equal(own.length, 2);
    assert.equal(other.length, 0);
    assert.equal(runs.find((run) => run.id === applied.run?.id)?.detail, "Harbor");
    assert.equal(await readSnapshot(sql, "owner-b"), null);
  });
});
