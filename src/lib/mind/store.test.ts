import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sql } from "../db.ts";
import { mergeWorkspaceEdits } from "./workspace-edits.ts";
import { emptyWorkspace, normalizeWorkspace } from "./workspace.ts";
import { readControl, readSnapshot, snapshotRevision, snapshotTooLarge, writeControl, writeSnapshot, writeWorkspaceChanges, writeSnapshotDelta } from "./store.ts";
import { createWorkspaceDelta } from "./workspace-delta.ts";
import { planWorkspaceChanges } from "./workspace-changes.ts";
import { addCustomAgent, enqueueRun, tickFleet, approveRunAction } from "./fleet.ts";

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
      if (text.includes("on conflict (user_id) do nothing") && bucket(table).has(String(values[0]))) return [];
      bucket(table).set(String(values[0]), { user_id: values[0], payload: values[1] ?? "{}", halted: values[1] });
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
  sql.query = async (text, values = []) => {
    const table = text.match(/\b(mind_[a-z_]+)\b/)?.[1] ?? "";
    if (text.startsWith("delete from")) {
      for (const id of values[1] as string[]) bucket(table).delete(`${values[0]}:${id}`);
    }
    return [];
  };
  sql.transaction = async (fn) => {
    const before = structuredClone(tables);
    try { return await fn(sql); } catch (error) { tables.clear(); for (const [key, value] of before) tables.set(key, value); throw error; }
  };
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

  it("rejects a stale snapshot without replacing a newer reply", async () => {
    const { sql } = memorySql();
    const base = emptyWorkspace();
    const chat = { id: "c", title: "Thread", memory: "off" as const, temporary: false, autonomy: "ask" as const, projectId: null, retrievalLog: [], messages: [] };
    base.chats = [chat];
    const revision = await writeSnapshot(sql, "owner", base);
    assert.equal(revision, snapshotRevision(await readSnapshot(sql, "owner")));
    const reply = { id: "reply", role: "assistant" as const, content: "Newest saved reply", at: new Date(0).toISOString() };
    const written = await writeSnapshot(sql, "owner", { ...base, chats: [{ ...chat, messages: [reply] }] }, revision!);
    assert.ok(written && written !== revision);
    assert.equal(await writeSnapshot(sql, "owner", { ...base, chats: [{ ...chat, title: "Stale" }] }, revision!), null);
    assert.equal(normalizeWorkspace(await readSnapshot(sql, "owner")).chats[0]?.messages[0]?.content, reply.content);
  });

  it("merges independent browser changes and leaves deleted chats removed", () => {
    const base = emptyWorkspace();
    const chat = { id: "a", title: "Thread A", memory: "off" as const, temporary: false, autonomy: "ask" as const, projectId: null, retrievalLog: [], messages: [] };
    const removed = { ...chat, id: "b", title: "Thread B" };
    base.chats = [chat, removed];
    const reply = { id: "reply", role: "assistant" as const, content: "Reply saved by A", at: new Date(0).toISOString() };
    const result = mergeWorkspaceEdits(
      { ...base, chats: [{ ...chat, messages: [reply] }] },
      base,
      { ...base, chats: [{ ...chat, title: "Renamed from B" }, { ...removed, title: "Stale edit" }] },
    );
    assert.deepEqual(result.chats, [{ ...chat, title: "Renamed from B", messages: [reply] }]);
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
    await writeSnapshot(sql, "owner", emptyWorkspace(), snapshotRevision(await readSnapshot(sql, "owner")));
    assert.equal(tables.get("mind_agent")?.has("owner:agent-1"), false);
    assert.equal(tables.get("mind_agent_run")?.has("owner:run-1"), false);
  });

  it("rejects a snapshot that is too large", () => {
    const ws = emptyWorkspace();
    ws.files.push({ id: "f", name: "big.txt", text: "x".repeat(1_500_000), bytes: 1_500_000, projectId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(snapshotTooLarge(ws), true);
  });

  it("incremental updates preserve unrelated mirrors and allow a workspace larger than one request", async () => {
    const { sql, mutations } = memorySql();
    const before = emptyWorkspace();
    before.projects = [{ id: "p", name: "Before", description: "", createdAt: "2026-01-01T00:00:00.000Z" }];
    before.files = Array.from({ length: 45 }, (_, index) => ({ id: `f${index}`, name: `${index}.txt`, text: "x".repeat(39000), bytes: 39000, projectId: null, createdAt: "2026-01-01T00:00:00.000Z" }));
    const revision = await writeSnapshot(sql, "owner", before);
    mutations.length = 0;
    const edited = { ...before, projects: [{ ...before.projects[0], name: "After" }] };
    const saved = await writeSnapshotDelta(sql, "owner", createWorkspaceDelta(before, edited), revision!);
    assert.equal(saved?.workspace.projects[0].name, "After");
    assert.equal(saved?.workspace.files.length, 45);
    assert.ok(!mutations.some((call) => /mind_file/.test(call.query)));
    assert.equal(mutations.filter((call) => /delete from mind_project/.test(call.query)).length, 1);
    assert.equal(await writeSnapshotDelta(sql, "owner", createWorkspaceDelta(before, edited), revision!), null);
    assert.equal(await readSnapshot(sql, "other-owner"), null);
  });

  it("reloads a project after the file database is closed and opened again", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { mkdtempSync, rmSync, readdirSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "mind-pglite-"));
    const files = readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort();
    const asSql = (pg: Pick<InstanceType<typeof PGlite>, "query"> & Partial<Pick<InstanceType<typeof PGlite>, "transaction">>): Sql => {
      const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
        let text = strings[0] ?? "";
        for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
        const result = await pg.query(text, values);
        return result.rows;
      }) as Sql;
      sql.query = async (text, params = []) => (await pg.query(text, params)).rows as never;
      if (pg.transaction) sql.transaction = (fn) => pg.transaction!((tx) => fn(asSql(tx)));
      return sql;
    };
    const first = new PGlite(dir);
    let second: InstanceType<typeof PGlite> | undefined;
    try {
      await first.waitReady;
      for (const name of files) await first.exec(readFileSync(join("migrations", name), "utf8"));
      const saved = emptyWorkspace();
      saved.projects.push({ id: "p1", name: "Lake", description: "", createdAt: "2026-01-01T00:00:00.000Z" });
      await writeSnapshot(asSql(first), "owner", saved);
      await first.close();
      second = new PGlite(dir);
      await second.waitReady;
      const loaded = normalizeWorkspace(await readSnapshot(asSql(second), "owner"));
      assert.equal(loaded?.projects[0]?.name, "Lake");
      assert.equal(await readSnapshot(asSql(second), "other"), null);
    } finally {
      if (second && !second.closed) await second.close();
      if (!first.closed) await first.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it("refuses a nontransactional adapter before issuing any statement", async () => {
  let touched = false;
  const unsafe = (async () => { touched = true; return []; }) as unknown as Sql;
  unsafe.query = async () => { touched = true; return []; };
  await assert.rejects(writeSnapshot(unsafe, "owner", emptyWorkspace()), /transactional/);
  assert.equal(touched, false);
});

it("requires an explicit revision before replacing an existing workspace", async () => {
  const { sql } = memorySql();
  const first = emptyWorkspace();
  first.projects.push({ id: "p", name: "Keep", description: "", createdAt: "2026-01-01" });
  await writeSnapshot(sql, "owner", first);
  assert.equal(await writeSnapshot(sql, "owner", emptyWorkspace()), null);
  assert.equal(normalizeWorkspace(await readSnapshot(sql, "owner")).projects[0].name, "Keep");
});

it("renaming one chat does not reconstruct unrelated resource collections", async () => {
  const { sql } = memorySql();
  const ws = emptyWorkspace();
  for (let i = 0; i < 2000; i++) ws.projects.push({ id: `p${i}`, name: `Project ${i}`, description: "", createdAt: "2026-01-01" });
  ws.chats.push({ id: "c", title: "Before", memory: "off", autonomy: "ask", temporary: false, projectId: null, messages: [], retrievalLog: [] });
  const revision = await writeSnapshot(sql, "owner", ws);
  const calls: string[] = [];
  const record = (async (strings: TemplateStringsArray, ...values: unknown[]) => { calls.push(strings.join("?")); return sql(strings, ...values); }) as Sql;
  record.query = (text, params) => { calls.push(text); return sql.query(text, params); };
  record.transaction = (fn) => sql.transaction!(() => fn(record));
  const next = { ...ws, chats: [{ ...ws.chats[0], title: "After" }] };
  assert.ok(await writeSnapshot(record, "owner", next, revision!));
  assert.equal(calls.filter((call) => /(?:delete from|insert into) mind_project/.test(call)).length, 0);
  assert.equal(calls.filter((call) => /delete from mind_chat/.test(call)).length, 1);
  assert.equal(calls.filter((call) => /insert into mind_chat/.test(call)).length, 1);
});

it("lists all 750 owners using deterministic bounded SQL pages", async () => {
  const { listSnapshotOwnerPage, listSnapshotUserIds } = await import("./store.ts");
  const owners = Array.from({ length: 750 }, (_, i) => `owner-${String(i).padStart(4, "0")}`);
  let pages = 0;
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    assert.match(strings.join("?"), /order by user_id asc limit/);
    pages++;
    return owners.filter((id) => id > String(values[0])).slice(0, Number(values[1])).map((user_id) => ({ user_id }));
  }) as Sql;
  const first = await listSnapshotOwnerPage(sql);
  assert.equal(first.ids.length, 500);
  assert.equal(first.nextCursor, "owner-0499");
  pages = 0;
  assert.deepEqual(await listSnapshotUserIds(sql), owners);
  assert.equal(pages, 2);
});

it("saves a changed resource beyond the aggregate bulk-copy limit without losing older resources", async () => {
  const { sql } = memorySql();
  const original = emptyWorkspace();
  original.chats = Array.from({ length: 40 }, (_, i) => ({ id: `chat-${i}`, title: `Thread ${i}`, memory: "off" as const, temporary: false, autonomy: "ask" as const, projectId: null, retrievalLog: [], messages: [{ id: `message-${i}`, role: "assistant" as const, content: "x".repeat(40000), at: "2026-11-26T00:00:00Z" }] }));
  await writeSnapshot(sql, "owner", original);
  const before = normalizeWorkspace(await readSnapshot(sql, "owner"));
  assert.equal(snapshotTooLarge(before), true);
  const after = { ...before, projects: [{ id: "new-project", name: "Saved independently", description: "", createdAt: "2026-11-26T00:00:00Z" }] };
  const changes = planWorkspaceChanges(before, after);
  assert.ok(JSON.stringify(changes).length < 1000);
  const revision = await writeWorkspaceChanges(sql, "owner", changes, snapshotRevision(await readSnapshot(sql, "owner")));
  assert.ok(revision);
  const saved = normalizeWorkspace(await readSnapshot(sql, "owner"));
  assert.equal(saved.projects[0].name, "Saved independently");
  assert.equal(saved.chats.length, 40); assert.equal(saved.chats[39].messages[0].content.length, 40000);
  assert.equal(await readSnapshot(sql, "other"), null);
  assert.equal(await writeWorkspaceChanges(sql, "owner", changes, snapshotRevision(before)), null);
});

it("resource deltas preserve deletion tombstones and server-owned in-flight operation authority", async () => {
  const { sql } = memorySql();
  const now = "2026-11-26T00:00:00Z";
  const made = addCustomAgent(emptyWorkspace(), { name: "Fixture", tools: ["model"], instructions: "Read", chatProvider: "gemini" }, now); assert.ok(made.ok);
  const queued = enqueueRun(made.ws, made.agent.id, "Read fixture", now); assert.ok(queued.ok);
  const pending = tickFleet(queued.ws, { now, workerId: "worker" });
  const granted = approveRunAction(pending, pending.runs[0].id, pending.runs[0].pendingApproval!.id, now);
  granted.chats.push({ id: "deleted-chat", title: "Old", memory: "off", autonomy: "ask", projectId: null, temporary: false, messages: [], retrievalLog: [] });
  await writeSnapshot(sql, "owner", granted);
  // The server, rather than a client snapshot, owns dispatch state.
  const raw = normalizeWorkspace(await readSnapshot(sql, "owner"));
  const run = raw.runs[0];
  run.externalOperation = { id: "op", stepId: run.plan[run.step].id, state: "dispatching", startedAt: now };
  run.approvalHistory = [{ ...run.pendingApproval!, state: "consumed" }]; run.pendingApproval = undefined; run.state = "running";
  raw.deletedChatIds = ["deleted-chat"]; raw.chats = [];
  const table = (await import("./store.ts"));
  await table.updateOwnerWorkspace(sql, "owner", () => ({ workspace: raw, result: null }));
  const revision = snapshotRevision(await readSnapshot(sql, "owner"));
  const attack = planWorkspaceChanges(normalizeWorkspace(await readSnapshot(sql, "owner")), granted);
  assert.ok(await writeWorkspaceChanges(sql, "owner", attack, revision));
  const saved = normalizeWorkspace(await readSnapshot(sql, "owner"));
  assert.deepEqual(saved.chats, []); assert.ok(saved.deletedChatIds!.includes("deleted-chat"));
  assert.equal(saved.runs[0].externalOperation!.state, "dispatching"); assert.equal(saved.runs[0].pendingApproval, undefined);
  assert.equal(saved.runs[0].approvalHistory![0].state, "consumed");
});
