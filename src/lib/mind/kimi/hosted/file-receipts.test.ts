import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { codingFileRequest, readCodingFileSnapshot } from "./file-receipts.ts";

test("missing and existing-empty files have different coding read outcomes", async t => {
  const cwd = mkdtempSync(join(tmpdir(), "coding-file-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, "empty"), "");
  const read = (path: string) => codingFileRequest({ cwd, ownerId: "fixture", allowWrite: false, method: "fs/read_text_file", params: { path }, persist: async () => true });
  assert.equal((await read("missing")).ok, false);
  assert.deepEqual((await read("empty")).result, { content: "", exists: true, truncated: false, totalLines: 1, startLine: 0, returnedCharacters: 0, selectedCharacters: 0 });
});

test("file review preserves complete bounded content and excerpts expose a usable continuation", async t => {
  const cwd = mkdtempSync(join(tmpdir(), "coding-review-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, "large.txt"), "x".repeat(30_000) + "IMPORTANT END");
  const snapshot = readCodingFileSnapshot(cwd, "large.txt"); assert.ok(snapshot.ok && snapshot.content.endsWith("IMPORTANT END"));
  const input = { cwd, ownerId: "fixture", allowWrite: false, method: "fs/read_text_file" as const, persist: async () => true };
  const first = await codingFileRequest({ ...input, params: { path: "large.txt" } });
  assert.equal(first.result?.truncated, true);
  const next = await codingFileRequest({ ...input, params: { path: "large.txt", ...first.result?.continuation as Record<string, unknown> } });
  assert.ok(String(next.result?.content).endsWith("IMPORTANT END"));
  assert.equal(readCodingFileSnapshot(cwd, "missing").ok, true);
});

test("workspace links do not grant read or write access to a different destination", async t => {
  const cwd = mkdtempSync(join(tmpdir(), "coding-owned-")); const outside = mkdtempSync(join(tmpdir(), "coding-other-"));
  t.after(() => { rmSync(cwd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  writeFileSync(join(outside, "file.txt"), "Other workspace"); symlinkSync(outside, join(cwd, "linked"), "dir");
  let persisted = false;
  const write = await codingFileRequest({ cwd, ownerId: "fixture", allowWrite: true, method: "fs/write_text_file", params: { path: "linked/file.txt", content: "wrong destination" }, persist: async () => { persisted = true; return true; } });
  assert.equal(write.receipt.status, "denied"); assert.equal(persisted, false); assert.equal(readFileSync(join(outside, "file.txt"), "utf8"), "Other workspace");
  assert.equal(readCodingFileSnapshot(cwd, "linked/file.txt").ok, false);
});

test("denied writes cannot produce a success receipt; persistence failure retains local evidence", async t => {
  const cwd = mkdtempSync(join(tmpdir(), "coding-write-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  let persisted = false;
  const input = { cwd, ownerId: "fixture", allowWrite: false, method: "fs/write_text_file" as const, params: { path: "file", content: "new content" }, persist: async () => { persisted = true; return false; } };
  const denied = await codingFileRequest(input); assert.equal(denied.receipt.status, "denied"); assert.equal(persisted, false);
  const partial = await codingFileRequest({ ...input, allowWrite: true });
  assert.equal(partial.ok, false); assert.equal(partial.receipt.status, "written_locally"); assert.equal(partial.receipt.durable, false);
  assert.equal(readFileSync(join(cwd, "file"), "utf8"), "new content");
  assert.deepEqual(partial.change, { path: "file", before: "", after: "new content", beforeExists: false });
  const saved = await codingFileRequest({ ...input, allowWrite: true, persist: async () => true });
  assert.equal(saved.ok, true); assert.equal(saved.receipt.durable, true);
  assert.deepEqual(saved.change, { path: "file", before: "new content", after: "new content", beforeExists: true });
});
