import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { claimTurn, finishTurnReceipt, pruneTurnReceipts, turnOperationExpiry } from "./turn-receipt.ts";

test("turn IDs have an issuance window before the receipt can expire", () => {
  const now = 1_800_000_000_000;
  const id = randomUUID();
  assert.equal(turnOperationExpiry(`${now - 24 * 3600000}-${id}`, now), null);
  assert.equal(turnOperationExpiry(`${now + 6 * 60000}-${id}`, now), null);
  assert.equal(turnOperationExpiry("send", now), null);
  assert.ok(turnOperationExpiry(`${now}-${id}`, now)!.getTime() > now + 24 * 3600000);
});

test("only one delivery claims an operation; the receipt survives restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mind-turn-receipts-"));
  let db = new PGlite(directory);
  const sql = (async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((text, part, i) => text + (i ? "$" + i : "") + part, "");
    return (await db.query(query, values)).rows;
  }) as Sql;
  const operation = `${Date.now()}-${randomUUID()}`;
  const expires = turnOperationExpiry(operation)!;
  const body = { conversation: "thread-1", provider: "gemini", text: "Temporary fixture input" };
  try {
    await db.exec(await readFile(new URL("../../../migrations/0010_mind_turn_receipts.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../../migrations/0011_mind_turn_retryable.sql", import.meta.url), "utf8"));
    const deliver = () => claimTurn(sql, "owner-1", operation, body, expires);
    assert.deepEqual((await Promise.all([deliver(), deliver()])).sort(), ["claimed", "waiting"]);
    assert.equal(await claimTurn(sql, "owner-1", operation, { ...body, provider: "openrouter" }, expires), "different");
    assert.equal(await claimTurn(sql, "owner-2", operation, body, expires), "claimed");
    await finishTurnReceipt(sql, "owner-1", operation, true);
    assert.equal(await claimTurn(sql, "owner-1", operation, { ...body, provider: "openrouter" }, expires), "different");
    assert.deepEqual((await Promise.all([deliver(), deliver()])).sort(), ["claimed", "waiting"]);
    await finishTurnReceipt(sql, "owner-1", operation);
    await db.close();
    db = new PGlite(directory);
    assert.equal(await deliver(), "responded");
    assert.equal(await claimTurn(sql, "owner-2", operation, body, expires), "waiting");
    await db.query("update mind_turn_receipt set expires_at = now() - interval '1 hour' where user_id = 'owner-1'");
    await pruneTurnReceipts(sql);
    const { rows } = await db.query("select user_id from mind_turn_receipt");
    assert.deepEqual(rows, [{ user_id: "owner-2" }]);
  } finally {
    await db.close();
    await rm(directory, { force: true, recursive: true });
  }
});
