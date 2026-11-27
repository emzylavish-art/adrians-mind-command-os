import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "../../db.ts";
import { runHostedFileOperation } from "./hosted-files.server.ts";
import { restoreWorkspaceFiles, restoreWorkspaceFilesDetailed } from "./persist.ts";
import { fileRevision } from "./file-revision.ts";

test("C1 AA037–040: actual hosted mutations bind revisions, report failed durable changes, and listing never restores stale data", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "c1-hosted-files-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "a.txt"), "newer on disk");
  let durableCalls = 0;
  const deps = { root, save: async () => { durableCalls++; return true; }, rename: async () => { durableCalls++; return false; }, forget: async () => { durableCalls++; return false; } };
  const call = (body: Parameters<typeof runHostedFileOperation>[0]) => runHostedFileOperation(body, "dev-user", deps);
  const listed = await (await call({ operation: "list" })).json();
  assert.equal(listed.total, 1);
  assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "newer on disk");
  assert.equal(durableCalls, 0);
  for (const operation of ["rename", "delete"] as const) {
    assert.equal((await call({ operation, path: "a.txt", to: "b.txt", confirm: true })).status, 409);
    assert.equal((await call({ operation, path: "a.txt", to: "b.txt", confirm: true, expectedRevision: fileRevision("stale") })).status, 409);
  }
  assert.equal(durableCalls, 0);
  assert.equal((await call({ operation: "write", path: "a.txt", content: "blind" })).status, 409);
  assert.equal((await call({ operation: "write", path: "a.txt", content: "blind", expectedMissing: true })).status, 409);
  assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "newer on disk");
  const saved = await (await call({ operation: "write", path: "a.txt", content: "reviewed change", expectedRevision: fileRevision("newer on disk") })).json();
  assert.equal(saved.ok, true);
  assert.equal(saved.result.revision, fileRevision("reviewed change"));
  const renamed = await call({ operation: "rename", path: "a.txt", to: "b.txt", confirm: true, expectedRevision: saved.result.revision });
  assert.equal(renamed.status, 503);
  assert.equal((await renamed.json()).reconciliationRequired, true);
  assert.equal(existsSync(join(root, "a.txt")), false);
  assert.equal(readFileSync(join(root, "b.txt"), "utf8"), "reviewed change");
  const deleted = await call({ operation: "delete", path: "b.txt", confirm: true, expectedRevision: saved.result.revision });
  assert.equal(deleted.status, 503);
  const outcome = await deleted.json();
  assert.equal(outcome.ok, false);
  assert.equal(outcome.applied, "filesystem");
  assert.equal(outcome.durable, false);
  assert.equal(existsSync(join(root, "b.txt")), false);
  writeFileSync(join(root, "kept.txt"), "newer");
  const sql = { query: async () => [{ path: "kept.txt", text_copy: "older stored" }, { path: "missing.txt", text_copy: "restore missing only" }] } as unknown as Sql;
  const preview = await restoreWorkspaceFilesDetailed("fixture", root, sql, false);
  assert.deepEqual(preview.conflicts, ["kept.txt"]);
  assert.deepEqual(preview.missing, ["missing.txt"]);
  assert.equal(existsSync(join(root, "missing.txt")), false, "reviewing recovery cannot write files");
  assert.equal(await restoreWorkspaceFiles("fixture", root, sql), 1);
  assert.equal(readFileSync(join(root, "kept.txt"), "utf8"), "newer");
  assert.equal(readFileSync(join(root, "missing.txt"), "utf8"), "restore missing only");
});

test("C1 AA042: hosted nested file/search pages remain reachable beyond the first limits, without symlinks or secrets", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "c1-hosted-tree-"));
  const outside = mkdtempSync(join(tmpdir(), "c1-hosted-outside-"));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  mkdirSync(join(root, "src/deep"), { recursive: true });
  for (let i = 1; i <= 230; i++) writeFileSync(join(root, `src/deep/${String(i).padStart(3, "0")}.txt`), "needle");
  writeFileSync(join(root, ".env"), "secret");
  symlinkSync(outside, join(root, "outside"), "dir");
  const call = (body: Parameters<typeof runHostedFileOperation>[0]) => runHostedFileOperation(body, "dev-user", { root });
  const first = await (await call({ operation: "list" })).json();
  assert.equal(first.files.length, 200);
  assert.equal(first.total, 230);
  const second = await (await call({ operation: "list", cursor: first.nextCursor })).json();
  assert.equal(second.files.length, 30);
  assert.equal(second.files[0].path, "src/deep/201.txt");
  const search = await (await call({ operation: "search", query: "needle" })).json();
  assert.equal(search.matches.length, 100);
  assert.equal(search.total, 230);
  const next = await (await call({ operation: "search", query: "needle", cursor: search.nextCursor })).json();
  assert.equal(next.matches[0].path, "src/deep/101.txt");
  assert.equal((await call({ operation: "rename", path: "src/deep/001.txt", to: "outside/escape.txt", confirm: true, expectedRevision: fileRevision("needle") })).status, 400);
  assert.equal(existsSync(join(outside, "escape.txt")), false);
});

after(async () => {
  const globals = globalThis as typeof globalThis & { __pgBootstrapPromise__?: Promise<void>; __pgliteInstance__?: Promise<{ close(): Promise<void> }> };
  await globals.__pgBootstrapPromise__;
  if (globals.__pgliteInstance__) await (await globals.__pgliteInstance__).close();
});
