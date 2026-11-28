import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { accountPhotoData } from "./account-photo.ts";
import { readAccountPhoto, saveAccountPhoto } from "./account-photo.server.ts";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==";

test("account photos accept bounded raster input that matches the declared format", () => {
  assert.equal(accountPhotoData(png), png);
  assert.equal(accountPhotoData(png.replace("image/png", "image/jpeg")), null);
  assert.equal(accountPhotoData("https://example.invalid/photo.png"), null);
  assert.equal(accountPhotoData(png + "A".repeat(160_000)), null);
});

test("account photo storage isolates owners and only accepts the current revision", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(await readFile(new URL("../../../migrations/0033_account_profile_photo.sql", import.meta.url), "utf8"));
    const sql = { query: async <T>(statement: string, values: unknown[]) => (await db.query<T>(statement, values)).rows } as Sql;
    const empty = { dataUrl: null, revision: null };
    assert.deepEqual(await readAccountPhoto(sql, "owner"), empty);
    const first = await saveAccountPhoto(sql, "owner", png, null);
    assert.ok(first?.revision);
    assert.deepEqual(await readAccountPhoto(sql, "other"), empty);
    assert.deepEqual(await saveAccountPhoto(sql, "owner", png, first.revision), first);
    assert.equal(await saveAccountPhoto(sql, "owner", null, null), undefined);
    const removed = await saveAccountPhoto(sql, "owner", null, first.revision);
    assert.equal(removed?.dataUrl, null);
    assert.notEqual(removed?.revision, first.revision);
    assert.equal(await saveAccountPhoto(sql, "owner", png, first.revision), undefined);
  } finally { await db.close(); }
});
