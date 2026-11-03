import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sql } from "../db.ts";
import { emptyWorkspace, normalizeWorkspace } from "./workspace.ts";
import { readControl, readSnapshot, snapshotTooLarge, writeControl, writeSnapshot } from "./store.ts";

function memorySql() {
  const tables = new Map<string, Map<string, unknown>>();
  const bucket = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ").replace(/\s+/g, " ");
    const table = text.match(/\b(mind_[a-z_]+)\b/)?.[1] ?? "";
    if (text.startsWith("delete from")) {
      for (const [key, row] of bucket(table)) {
        if ((row as { user_id: string }).user_id === values[0]) bucket(table).delete(key);
      }
      return [];
    }
    if (text.startsWith("insert into mind_snapshot") || text.startsWith("insert into mind_control")) {
      bucket(table).set(String(values[0]), { user_id: values[0], payload: values[1], halted: values[1] });
      return [];
    }
    if (text.startsWith("insert into")) {
      bucket(table).set(`${values[0]}:${values[1]}`, { user_id: values[0] });
      return [];
    }
    if (text.startsWith("select payload")) {
      const row = bucket("mind_snapshot").get(String(values[0])) as { payload: unknown } | undefined;
      return row ? [row] : [];
    }
    if (text.startsWith("select halted")) {
      const row = bucket("mind_control").get(String(values[0])) as { halted: boolean } | undefined;
      return row ? [row] : [];
    }
    return [];
  }) as Sql;
  sql.query = async () => [];
  return { sql, tables };
}

describe("mind store", () => {
  it("saves and reloads one owner's snapshot without returning another owner's rows", async () => {
    const { sql } = memorySql();
    const mine = emptyWorkspace();
    mine.projects.push({ id: "p1", name: "Lake", description: "", createdAt: "2026-01-01T00:00:00.000Z" });
    await writeSnapshot(sql, "owner", mine);
    await writeControl(sql, "owner", true);
    const loaded = normalizeWorkspace(await readSnapshot(sql, "owner"));
    assert.equal(loaded?.projects[0]?.name, "Lake");
    assert.equal(await readSnapshot(sql, "other"), null);
    assert.equal(await readControl(sql, "owner"), true);
    assert.equal(await readControl(sql, "other"), false);
  });

  it("keeps two owners' snapshots apart", async () => {
    const { sql, tables } = memorySql();
    const first = emptyWorkspace();
    first.projects.push({ id: "p1", name: "Lake", description: "", createdAt: "2026-01-01T00:00:00.000Z" });
    first.chats.push({
      id: "c1",
      title: "Dock",
      memory: "off",
      temporary: false,
      autonomy: "ask",
      projectId: null,
      retrievalLog: [],
      messages: [],
    });
    const second = emptyWorkspace();
    second.projects.push({ id: "p2", name: "Other", description: "", createdAt: "2026-01-01T00:00:00.000Z" });
    await writeSnapshot(sql, "owner-a", first);
    await writeSnapshot(sql, "owner-b", second);
    assert.equal(normalizeWorkspace(await readSnapshot(sql, "owner-a"))?.projects[0]?.name, "Lake");
    assert.equal(normalizeWorkspace(await readSnapshot(sql, "owner-b"))?.projects[0]?.name, "Other");
    assert.equal(tables.get("mind_chat")?.has("owner-a:c1"), true);
    assert.equal([...(tables.get("mind_chat")?.keys() ?? [])].some((key) => String(key).startsWith("owner-b:")), false);
  });

  it("stores agents and runs for one owner and removes them on the next save", async () => {
    const { sql, tables } = memorySql();
    const ws = emptyWorkspace();
    ws.agents.push({
      id: "agent-1",
      name: "Documents",
      description: "",
      role: "documents",
      instructions: "",
      version: 1,
      tools: ["search_notes"],
      projectId: null,
      memory: "off",
      maxSteps: 2,
      approval: "automatic",
      archived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    ws.runs.push({
      id: "run-1",
      agentId: "agent-1",
      parentId: null,
      depth: 0,
      goal: "Read notes",
      state: "queued",
      step: 0,
      maxSteps: 2,
      workerId: null,
      leaseUntil: null,
      approvedActions: [],
      plan: [],
      result: "",
      error: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await writeSnapshot(sql, "owner", ws);
    assert.equal(tables.get("mind_agent")?.has("owner:agent-1"), true);
    assert.equal(tables.get("mind_agent_run")?.has("owner:run-1"), true);
    await writeSnapshot(sql, "owner", emptyWorkspace());
    assert.equal(tables.get("mind_agent")?.has("owner:agent-1"), false);
    assert.equal(tables.get("mind_agent_run")?.has("owner:run-1"), false);
  });

  it("rejects a snapshot that is too large", () => {
    const ws = emptyWorkspace();
    ws.files.push({ id: "f", name: "big.txt", text: "x".repeat(1_500_000), bytes: 1_500_000, projectId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(snapshotTooLarge(ws), true);
  });

  it("rejects oversized snapshots before touching previously saved records", async () => {
    const { sql, tables } = memorySql();
    const original = emptyWorkspace();
    original.projects.push({ id: "p1", name: "Lake", description: "", createdAt: "2026-01-01T00:00:00.000Z" });
    await writeSnapshot(sql, "owner", original);
    const oversized = emptyWorkspace();
    oversized.files.push({ id: "big", name: "big.txt", text: "x".repeat(1_500_000), bytes: 1_500_000, projectId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    await assert.rejects(writeSnapshot(sql, "owner", oversized), /maximum supported size/);
    assert.equal(tables.get("mind_project")?.has("owner:p1"), true);
    assert.equal(normalizeWorkspace(await readSnapshot(sql, "owner"))?.projects[0]?.name, "Lake");
  });

  it("reloads a project after the file database is closed and opened again", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { mkdtempSync, readdirSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "mind-pglite-"));
    const files = readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort();
    const asSql = (pg: InstanceType<typeof PGlite>): Sql => {
      const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
        let text = strings[0] ?? "";
        for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
        const result = await pg.query(text, values);
        return result.rows;
      }) as Sql;
      sql.query = async (text, params = []) => (await pg.query(text, params)).rows as never;
      sql.transaction = async (fn) => pg.transaction(async (tx) => {
        const transactional = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
          let text = strings[0] ?? "";
          for (let i = 0; i < values.length; i += 1) text += `${i + 1}${strings[i + 1] ?? ""}`;
          return (await tx.query(text, values)).rows;
        }) as Sql;
        transactional.query = async (text, params = []) => (await tx.query(text, params)).rows as never;
        return fn(transactional);
      });
      return sql;
    };
    const first = new PGlite(dir);
    await first.waitReady;
    for (const name of files) await first.exec(readFileSync(join("migrations", name), "utf8"));
    const saved = emptyWorkspace();
    saved.projects.push({ id: "p1", name: "Lake", description: "", createdAt: "2026-01-01T00:00:00.000Z" });
    await writeSnapshot(asSql(first), "owner", saved);
    const broken = emptyWorkspace();
    const duplicateAt = "2026-01-01T00:00:00.000Z";
    broken.projects.push(
      { id: "dup", name: "First", description: "", createdAt: duplicateAt },
      { id: "dup", name: "Second", description: "", createdAt: duplicateAt },
    );
    await assert.rejects(writeSnapshot(asSql(first), "owner", broken));
    const originalRows = await first.query<{ id: string; name: string }>(
      "select id, name from mind_project where user_id = $1", ["owner"],
    );
    assert.deepEqual(originalRows.rows, [{ id: "p1", name: "Lake" }]);
    assert.equal(normalizeWorkspace(await readSnapshot(asSql(first), "owner"))?.projects[0]?.name, "Lake");
    await first.close();
    const second = new PGlite(dir);
    await second.waitReady;
    const loaded = normalizeWorkspace(await readSnapshot(asSql(second), "owner"));
    assert.equal(loaded?.projects[0]?.name, "Lake");
    assert.equal(await readSnapshot(asSql(second), "other"), null);
    await second.close();
  });
});
