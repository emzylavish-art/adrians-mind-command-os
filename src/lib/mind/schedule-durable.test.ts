import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { addAgentFromTemplate, addSchedule } from "./fleet.ts";
import { updateSharedHalt } from "./halt.server.ts";
import { handleScheduleTick } from "./schedule-tick.server.ts";
import { readSnapshot } from "./store.ts";
import { runLocalSchedulePass } from "./worker-pass.ts";
import { emptyWorkspace, normalizeWorkspace } from "./workspace.ts";

function sqlAdapter(db: PGlite | Transaction): Sql {
  const query: Sql["query"] = async function <T>(text: string, params?: unknown[]) {
    return (await db.query<T>(text, params)).rows;
  };
  const sql = (async <T>(strings: TemplateStringsArray, ...params: unknown[]) =>
    query<T>(strings.reduce((text, part, i) => text + (i ? "$" + i : "") + part, ""), params)) as Sql;
  sql.query = query;
  if (db instanceof PGlite) sql.transaction = (fn) => db.transaction(tx => fn(sqlAdapter(tx)));
  return sql;
}

test("two hosted scheduler requests commit a single occurrence and honor a stop committed after preflight", async () => {
  const db = await PGlite.create();
  try {
    for (const name of ["0002_mind.sql", "0003_fleet.sql"]) {
      await db.exec(await readFile(new URL("../../../migrations/" + name, import.meta.url), "utf8"));
    }
    const sql = sqlAdapter(db);
    const now = "2026-11-28T12:00:00Z";
    const made = addAgentFromTemplate(emptyWorkspace(), "Documents", now);
    if (!made.ok) throw new Error(made.error);
    made.agent.tools = ["list_projects"];
    const saved = addSchedule(made.ws, "Local document list", made.agent.id, 60, now);
    if (!saved.ok) throw new Error(saved.error);
    saved.ws.schedules[0].executionTarget = "hosted-worker";
    for (const owner of ["active-owner", "stopped-owner"]) {
      await sql.query("insert into mind_snapshot (user_id,payload) values ($1,$2::jsonb)", [owner, JSON.stringify(saved.ws)]);
    }
    const token = "ephemeral-scheduler-fixture-token-2026";
    let stopped = false;
    const pass = (worker: string, at: string) => handleScheduleTick(
      new Request("http://localhost/api/mind/schedules/tick", { method: "POST", headers: { authorization: "Bearer " + token } }),
      { token, pass: () => runLocalSchedulePass(sql, at, worker, async owner => {
        if (owner === "stopped-owner" && !stopped) {
          stopped = true;
          await updateSharedHalt(sql, owner, true);
        }
        return "off";
      }, "hosted-worker") },
    );
    const first = await pass("first", now);
    assert.equal(first.status, 200);
    const next = await Promise.all([pass("second", "2026-11-28T12:00:30Z"), pass("third", "2026-11-28T12:00:30Z")]);
    assert.ok(next.every(result => result.status === 200));
    const sums = await Promise.all(next.map(result => result.json()));
    assert.equal(sums.reduce((total, result) => total + result.summary.ran, 0), 1);
    const current = normalizeWorkspace(await readSnapshot(sql, "active-owner"));
    assert.equal(current.runs.filter(run => run.state === "completed" && run.id.startsWith("scheduled:")).length, 1);
    const halted = normalizeWorkspace(await readSnapshot(sql, "stopped-owner"));
    assert.equal(halted.halted, true);
    assert.equal(halted.schedules[0].enabled, false);
    assert.equal(halted.runs.length, 0);
  } finally { await db.close(); }
});
