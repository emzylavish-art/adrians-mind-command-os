import assert from "node:assert/strict";
import { it } from "node:test";
import type { Sql } from "./db.ts";
import { verifyDatabaseReadiness } from "./database-readiness.ts";

it("does not report an unreachable hosted database ready or disclose its error details", async () => {
  const query: Sql["query"] = async () => { throw new Error("postgres://private-user:secret@private-host"); };
  await assert.rejects(verifyDatabaseReadiness({ query }), (error: Error) => /could not be reached/.test(error.message) && !/secret|private-host/.test(error.message));
});

it("requires the workspace schema and reads no owner content", async () => {
  const calls: string[] = [];
  const query: Sql["query"] = async (text) => { calls.push(text); return []; };
  assert.deepEqual(await verifyDatabaseReadiness({ query }), { connected: true, workspaceSchema: true });
  assert.equal(calls.length, 4);
  for (const text of calls.slice(1)) assert.match(text, /limit 0$/);
  await assert.rejects(verifyDatabaseReadiness({ query: async (text) => { if (text.includes("mind_chat")) throw Error("missing relation"); return []; } }), /required workspace schema/);
});
