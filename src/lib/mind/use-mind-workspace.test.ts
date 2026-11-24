import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { saveFailureMessage } from "./save-error.ts";

import { createWorkspaceCheckpoint } from "./workspace-checkpoint.ts";
import { createMemoryBlobStore, INLINE_OFFLOAD_CHARS } from "./media/blob-store.ts";
import { emptyWorkspace } from "./workspace.ts";
import type { Workspace } from "./types.ts";

describe("save failure messaging", () => {
  it("returns null when save succeeded", () => {
    assert.equal(saveFailureMessage({ ok: true }), null);
  });

  it("keeps an explicit error and preserves content by not inventing a wipe", () => {
    const msg = saveFailureMessage({ ok: false, error: "The server copy could not be saved. The browser copy was kept." });
    assert.match(msg ?? "", /browser copy was kept/i);
  });

  it("falls back to the honest default when error text is missing", () => {
    const msg = saveFailureMessage({ ok: false });
    assert.match(msg ?? "", /could not be saved/i);
  });
});

describe("synchronous navigation checkpoint", () => {
  it("keeps new image bytes inline until the write commits, then reuses only that image's verified blob", async () => {
    const checkpoint = createWorkspaceCheckpoint();
    const store = createMemoryBlobStore();
    const image = { dataUrl: "data:image/png;base64," + "A".repeat(INLINE_OFFLOAD_CHARS), name: "proof.png" };
    const ws: Workspace = { ...emptyWorkspace(), chats: [{
      id: "chat", title: "Proof", memory: "off", temporary: false, autonomy: "ask", projectId: null, retrievalLog: [],
      messages: [{ id: "msg", role: "user", content: "Read this", at: "now", images: [image] }],
    }] };
    const compaction = checkpoint.compact(ws, store);
    const beforeCommit = checkpoint.snapshot(ws);
    assert.equal(beforeCommit.chats[0].messages[0].images?.[0].dataUrl, image.dataUrl);
    const saved = await compaction;
    ws.chats[0].messages.push({ id: "reply", role: "assistant", content: "Finished", at: "later" });
    const immediatelySaved = checkpoint.snapshot(ws);
    assert.equal(immediatelySaved.chats[0].messages.at(-1)?.content, "Finished");
    const savedImage = immediatelySaved.chats[0].messages[0].images?.[0];
    assert.equal(savedImage?.blobId, saved.chats[0].messages[0].images?.[0].blobId);
    assert.equal(savedImage?.dataUrl, undefined);
    const freshAccount = createWorkspaceCheckpoint();
    assert.equal(freshAccount.snapshot(ws).chats[0].messages[0].images?.[0].dataUrl, image.dataUrl);
    const restored = await freshAccount.hydrate(immediatelySaved, store);
    assert.equal(restored.chats[0].messages[0].images?.[0].dataUrl, image.dataUrl);
    assert.equal(freshAccount.snapshot(restored).chats[0].messages[0].images?.[0].blobId, savedImage?.blobId);
  });
});
