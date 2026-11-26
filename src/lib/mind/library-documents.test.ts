import { extractPdfText, selectPdfChunks } from "./pdf-text.ts";
import assert from "node:assert/strict";
import { it } from "node:test";
import { originalFileDatabase, prepareLibraryDocument, readVerifiedOriginal, replaceLibraryDocument, restoreLibraryVersion, saveLibraryDocument, updateLibraryDocument, parseCsvPreview, type OriginalFileStore } from "./library-documents.ts";
import { emptyWorkspace, normalizeWorkspace, packWorkspace, unpackWorkspace } from "./workspace.ts";

function store(): OriginalFileStore & { rows: Map<string, Blob> } {
  const rows = new Map<string, Blob>();
  return { rows, put: async (id, blob) => { rows.set(id, blob); }, get: async (id) => rows.get(id), remove: async (id) => { rows.delete(id); }, clear: async () => { rows.clear(); } };
}

it("preserves a >400KB original independently of a bounded text preview and verifies download bytes", async () => {
  const blobs = store();
  const file = new File(["x".repeat(500_000), "FINAL_REQUIREMENT"], "large.md", { type: "text/markdown" });
  const saved = await prepareLibraryDocument(file, { projectId: null, store: blobs });
  assert.equal(saved.bytes, file.size);
  assert.equal(saved.text.length, 40_000);
  assert.equal(saved.partial, true);
  assert.match(await (await readVerifiedOriginal(saved, blobs)).text(), /FINAL_REQUIREMENT$/);
  assert.ok(saved.original?.sha256);
  blobs.rows.set(saved.original!.blobId, new Blob(["corrupted"]));
  await assert.rejects(readVerifiedOriginal(saved, blobs), /integrity/);
});

it("preserves an original PDF when extraction cannot decode scanned pages", async () => {
  const blobs = store();
  const file = new File(["%PDF synthetic scanned fixture"], "scan.pdf", { type: "application/pdf" });
  const saved = await prepareLibraryDocument(file, { projectId: null, store: blobs, extractPdf: async () => ({ ok: false, error: "No text layer in fixture" }) });
  assert.equal(saved.text, "");
  assert.ok(saved.original);
  const normalized = normalizeWorkspace({ ...emptyWorkspace(), files: [saved] });
  assert.equal(normalized.files.length, 1);
  assert.equal(await (await readVerifiedOriginal(normalized.files[0], blobs)).text(), "%PDF synthetic scanned fixture");
});

it("isolates original-file databases by owner and rejects delayed uploads after destination changes", async () => {
  assert.notEqual(originalFileDatabase("alpha"), originalFileDatabase("beta"));
  const blobs = store(); let current = true;
  const file = new File(["%PDF fixture"], "plan.pdf", { type: "application/pdf" });
  await assert.rejects(prepareLibraryDocument(file, { projectId: "p1", store: blobs, isCurrent: () => current, extractPdf: async () => { current = false; return { ok: true, text: "private marker" }; } }), /destination changed/);
  assert.equal(blobs.rows.size, 0);
});

it("retains previous file versions and rejects a stale replacement", async () => {
  const blobs = store();
  const first = await prepareLibraryDocument(new File(["first"], "plan.md"), { projectId: "p", store: blobs });
  const second = await prepareLibraryDocument(new File(["second"], "plan.md"), { projectId: "p", store: blobs });
  const replaced = replaceLibraryDocument(first, second);
  assert.equal(replaced.id, first.id);
  const restored = restoreLibraryVersion(replaced, first.versionId!)!;
  assert.equal(restored.text, "first");
  assert.equal(restored.versions?.length, 2);
  assert.equal(await (await readVerifiedOriginal(restored, blobs)).text(), "first");
  const ws = { ...emptyWorkspace(), files: [replaced] };
  assert.equal(updateLibraryDocument(ws, restored, first.versionId!).ok, false);
  assert.equal(updateLibraryDocument(ws, restored, replaced.versionId!).ok, true);
  const packed = await packWorkspace(ws, false);
  assert.equal((await unpackWorkspace(JSON.stringify(packed))).ok, true);
});

it("does not evict forty existing text files when an original document is added", async () => {
  const original = await prepareLibraryDocument(new File(["new"], "new.txt"), { projectId: null, store: store() });
  const ws = emptyWorkspace();
  ws.files = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, name: `${i}.txt`, text: "keep", bytes: 4, projectId: null, createdAt: "2026-01-01" }));
  const result = saveLibraryDocument(ws, original);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.workspace.files.length, 41);
});

it("parses quoted CSV delimiters and discloses bounded previews", () => {
  assert.deepEqual(parseCsvPreview('name,description\nA,"two, words"\nB,"line\ncontinued"').rows, [["name", "description"], ["A", "two, words"], ["B", "line\ncontinued"]]);
  assert.equal(parseCsvPreview("one\ntwo\nthree", 2).truncated, true);
});

it("a Library PDF retains late, page-attributed text and its original evidence on save and reload", async () => {
  const pdf = ["%PDF-1.4", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R 5 0 R] >> endobj", "3 0 obj << /Type /Page /Contents 4 0 R >> endobj",
    "4 0 obj << >> stream\n(" + "alpha ".repeat(7000) + ") Tj\nendstream endobj", "5 0 obj << /Type /Page /Contents 6 0 R >> endobj",
    "6 0 obj << >> stream\n(LATE_RENEWAL) Tj\nendstream endobj"].join("\n");
  const saved = await prepareLibraryDocument(new File([pdf], "contract.pdf"), { store: store(), projectId: null, extractPdf: extractPdfText });
  const result = saveLibraryDocument(emptyWorkspace(), saved);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const [file] = normalizeWorkspace(JSON.parse(JSON.stringify(result.workspace))).files;
  assert.equal(file.text.length, 40_000);
  assert.equal(file.evidenceIndex?.sourceSha256, saved.original.sha256);
  assert.ok(file.document);
  assert.match(selectPdfChunks(file.document, { query: "LATE_RENEWAL", maxChars: 80 }).text, /PDF page 2,[^\]]+\]\nLATE_RENEWAL/);
});
