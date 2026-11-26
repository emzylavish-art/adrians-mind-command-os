import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sql } from "../../db.ts";
import { emptyWorkspace } from "../workspace.ts";
import { writeSnapshot } from "../store.ts";
import {
  createOwnerMemory,
  deleteOwnerMemory,
  editOwnerMemory,
  listOwnerMemories,
} from "./owner-ops.ts";
import { MEMORY_TEXT_MAX } from "./constants.ts";
import { sanitizeMemoryText } from "./sanitize.ts";
import { promptSkipRefusal, memoryInjectionAllowed } from "./skip.ts";
import { memorySignalFromSave, shouldPersistTurnMemory, emptyMemorySignal } from "./signal.ts";
import { createChat, addMemory } from "../workspace.ts";

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

describe("memory owner ops", () => {
  it("lists, edits, and deletes only the signed-in owner's memories", async () => {
    const { sql } = memorySql();
    const created = await createOwnerMemory(sql, "owner-a", {
      scope: "global",
      text: "Pier depth is 12 feet",
      source: "owner",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const listedA = await listOwnerMemories(sql, "owner-a");
    assert.equal(listedA.memories.length, 1);
    assert.equal(listedA.memories[0]?.text, "Pier depth is 12 feet");

    const listedB = await listOwnerMemories(sql, "owner-b");
    assert.equal(listedB.memories.length, 0);

    const editB = await editOwnerMemory(sql, "owner-b", created.item.id, "hijack");
    assert.equal(editB.ok, false);

    const deleteB = await deleteOwnerMemory(sql, "owner-b", created.item.id);
    assert.equal(deleteB.ok, false);

    const stillA = await listOwnerMemories(sql, "owner-a");
    assert.equal(stillA.memories[0]?.text, "Pier depth is 12 feet");

    const edited = await editOwnerMemory(sql, "owner-a", created.item.id, "Pier depth is 14 feet");
    assert.equal(edited.ok, true);
    if (edited.ok) assert.equal(edited.item.text, "Pier depth is 14 feet");

    const deleted = await deleteOwnerMemory(sql, "owner-a", created.item.id);
    assert.equal(deleted.ok, true);
    assert.equal((await listOwnerMemories(sql, "owner-a")).memories.length, 0);
  });

  it("owner B cannot read owner A's memory via list after A wrote a snapshot", async () => {
    const { sql } = memorySql();
    const ws = emptyWorkspace();
    const withNote = addMemory(ws, {
      scope: "global",
      text: "secret-for-a",
      source: "owner",
      projectId: null,
      chatId: null,
    });
    await writeSnapshot(sql, "owner-a", withNote);
    const bList = await listOwnerMemories(sql, "owner-b");
    assert.equal(bList.memories.some((item) => item.text.includes("secret-for-a")), false);
    const aList = await listOwnerMemories(sql, "owner-a");
    assert.equal(aList.memories.some((item) => item.text === "secret-for-a"), true);
  });

  it("caps huge text and keeps unicode; script tags are stored as plain text for React escape", async () => {
    assert.equal(sanitizeMemoryText("  hi  "), "hi");
    assert.equal(sanitizeMemoryText("x".repeat(MEMORY_TEXT_MAX + 50)).length, MEMORY_TEXT_MAX);
    const unicode = "深度 π — 湖 🌊";
    assert.equal(sanitizeMemoryText(unicode), unicode);
    const injected = "<script>alert(1)</script>";
    assert.equal(sanitizeMemoryText(injected), injected);
    const { sql } = memorySql();
    const created = await createOwnerMemory(sql, "owner", {
      scope: "global",
      text: injected + " " + unicode,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.match(created.item.text, /<script>/);
    assert.match(created.item.text, /🌊/);
  });

  it("rejects empty memory create/edit", async () => {
    const { sql } = memorySql();
    const empty = await createOwnerMemory(sql, "owner", { scope: "global", text: "   " });
    assert.equal(empty.ok, false);
  });
});

describe("per-chat memory skip", () => {
  it("skips injection when chat memory is off", () => {
    assert.equal(memoryInjectionAllowed("off"), false);
    assert.equal(memoryInjectionAllowed("on"), true);
    const refusal = promptSkipRefusal("off", [{ id: "n1", text: "should not inject" }]);
    assert.ok(refusal);
    assert.match(refusal ?? "", /Memory is off/i);
    assert.equal(promptSkipRefusal("on", [{ id: "n1", text: "ok" }]), null);
  });

  it("memoriesForChat path returns nothing when skip flag is set", async () => {
    const { injectableMemoriesForChat } = await import("./skip.ts");
    let ws = emptyWorkspace();
    const made = createChat(ws, { memory: "off", autonomy: "ask", temporary: false, projectId: null });
    ws = addMemory(made.ws, {
      scope: "global",
      text: "note",
      source: "owner",
      projectId: null,
      chatId: null,
    });
    assert.deepEqual(injectableMemoriesForChat(ws, made.chat), []);
  });
});

describe("turn memory save signal", () => {
  it("emits memorySaved only when a save actually landed", () => {
    assert.deepEqual(emptyMemorySignal(), { memorySaved: false, savedMemoryId: null });
    assert.deepEqual(memorySignalFromSave({ ok: false }), { memorySaved: false, savedMemoryId: null });
    assert.deepEqual(memorySignalFromSave({ ok: true, id: "m1" }), {
      memorySaved: true,
      savedMemoryId: "m1",
    });
    assert.equal(shouldPersistTurnMemory({ memory: "off", saveText: "keep this" }), false);
    assert.equal(shouldPersistTurnMemory({ memory: "on", saveText: "keep this" }), true);
    assert.equal(shouldPersistTurnMemory({ memory: "on", saveText: "  " }), false);
  });
});
