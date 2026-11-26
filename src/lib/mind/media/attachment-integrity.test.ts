import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachmentIssues, attachmentManifest, MAX_ATTACHMENT_DATA_CHARS, prepareAccountAttachments } from "./attachment-integrity.ts";
import { createMemoryBlobStore, hydrateWorkspaceImages, scopedImageStore } from "./blob-store.ts";
import { emptyWorkspace, normalizeWorkspace, packWorkspace, unpackWorkspace } from "../workspace.ts";
import type { Workspace } from "../types.ts";

const bytes = "data:image/png;base64,YQ==";
const id = `acct_${"a".repeat(64)}`;
const ws = (image: { dataUrl?: string; blobId?: string }): Workspace => ({ ...emptyWorkspace(), chats: [{ id: "c", title: "Images", memory: "off", temporary: false, autonomy: "ask", projectId: null, retrievalLog: [], messages: [{ id: "m", at: "now", role: "user", content: "Review", images: [{ name: "proof.png", ...image }] }] }] });

describe("C4 attachment completeness", () => {
  it("normalization preserves an image at the old 1,500,000-character boundary", () => {
    const source = "data:image/png;base64," + "A".repeat(1_500_000);
    assert.equal(normalizeWorkspace(ws({ dataUrl: source })).chats[0].messages[0].images?.[0].dataUrl, source);
    assert.equal(attachmentIssues(ws({ dataUrl: source })).length, 0);
    const tooLarge = "data:image/png;base64,".padEnd(MAX_ATTACHMENT_DATA_CHARS, "A");
    assert.equal(attachmentIssues(ws({ dataUrl: tooLarge })).length, 1);
    assert.equal(attachmentIssues(ws({ dataUrl: tooLarge.slice(0, -1) })).length, 0);
  });

  it("verifies upload before replacing bytes and retrieves on a clean second device", async () => {
    const original = ws({ dataUrl: bytes });
    const account = createMemoryBlobStore();
    let calls = 0;
    const prepared = await prepareAccountAttachments(original, async (dataUrl) => {
      calls++; await account.put(id, dataUrl); return { ok: true, id };
    });
    assert.equal(prepared.ok, true); assert.equal(calls, 1);
    if (!prepared.ok) return;
    assert.equal(prepared.workspace.chats[0].messages[0].images?.[0].dataUrl, undefined);
    assert.equal(original.chats[0].messages[0].images?.[0].dataUrl, bytes);
    const secondDevice = scopedImageStore(createMemoryBlobStore(), createMemoryBlobStore(), new Set(), account.get);
    const hydrated = await hydrateWorkspaceImages(prepared.workspace, secondDevice);
    assert.equal(hydrated.chats[0].messages[0].images?.[0].dataUrl, bytes);
  });

  it("keeps local bytes and does not fabricate a reference after upload failure", async () => {
    const original = ws({ dataUrl: bytes });
    assert.deepEqual(await prepareAccountAttachments(original, async () => ({ ok: false, error: "Account storage unavailable" })), { ok: false, error: "Account storage unavailable" });
    assert.equal(original.chats[0].messages[0].images?.[0].dataUrl, bytes);
    assert.equal(original.chats[0].messages[0].images?.[0].blobId, undefined);
  });

  it("can hydrate a verified account image when the optional device cache is unavailable", async () => {
    const unavailable = { get: async () => { throw Error("IndexedDB blocked"); }, put: async () => { throw Error("quota"); } };
    const account = scopedImageStore(unavailable, createMemoryBlobStore(), new Set(), async (asked) => asked === id ? bytes : undefined);
    assert.equal(await account.get(id), bytes);
  });

  it("does not trust a supplied account blob ID for different image bytes", async () => {
    let uploaded = "";
    await prepareAccountAttachments(ws({ dataUrl: bytes, blobId: id }), async (value) => { uploaded = value; return { ok: true, id }; });
    assert.equal(uploaded, bytes);
  });

  it("distinguishes a valid archive from a complete attachment backup on export and import", async () => {
    const source = ws({ blobId: "missing" });
    const archive = await packWorkspace(source, false);
    assert.equal(archive.attachments.complete, false);
    assert.equal(archive.attachments.referenced, 1);
    assert.equal(archive.attachments.included, 0);
    // Claims in an external manifest are never trusted; import recomputes completeness.
    const opened = await unpackWorkspace(JSON.stringify({ ...archive, attachments: { complete: true } }));
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.attachments.complete, false);
    assert.match(opened.warnings[0], /no image bytes/);
    assert.equal(opened.workspace.chats[0].messages[0].images?.[0].blobId, "missing");
    assert.equal(attachmentManifest(ws({ dataUrl: bytes })).complete, true);
  });

  it("migrates only owner-validated legacy references and leaves interrupted migrations recoverable", async () => {
    const legacy = createMemoryBlobStore({ owned: bytes, unrelated: bytes });
    const own = createMemoryBlobStore();
    const accountA = scopedImageStore(own, legacy, new Set(["owned"]));
    const accountB = scopedImageStore(createMemoryBlobStore(), legacy, new Set());
    assert.equal(await accountB.get("owned"), undefined);
    assert.equal(await accountA.get("unrelated"), undefined);
    assert.equal(await accountA.get("owned"), bytes);
    assert.equal(await legacy.get("owned"), undefined);
    assert.equal(await own.get("owned"), bytes);
    const interrupted = scopedImageStore({ get: async () => undefined, put: async () => { throw Error("quota"); } }, legacy, new Set(["unrelated"]));
    assert.equal(await interrupted.get("unrelated"), bytes);
    assert.equal(await legacy.get("unrelated"), bytes);
  });
});
