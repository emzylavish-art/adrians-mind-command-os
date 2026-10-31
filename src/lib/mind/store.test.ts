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
    const table = text.match(/mind_[a-z]+/)?.[0] ?? "";
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

  it("rejects a snapshot that is too large", () => {
    const ws = emptyWorkspace();
    ws.files.push({ id: "f", name: "big.txt", text: "x".repeat(1_500_000), bytes: 1_500_000, projectId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(snapshotTooLarge(ws), true);
  });
});
