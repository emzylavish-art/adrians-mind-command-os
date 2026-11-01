import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactImageRefs,
  compactWorkspaceImages,
  createMemoryBlobStore,
  hydrateImageRefs,
  hydrateWorkspaceImages,
  INLINE_OFFLOAD_CHARS,
  shouldOffloadDataUrl,
} from "./blob-store.ts";

const big = `data:image/png;base64,${"a".repeat(INLINE_OFFLOAD_CHARS)}`;
const small = "data:image/png;base64,aaa";

describe("media blob store compaction", () => {
  it("leaves small inline images alone", async () => {
    assert.equal(shouldOffloadDataUrl(small), false);
    const store = createMemoryBlobStore();
    const compacted = await compactImageRefs([{ dataUrl: small, name: "dot.png" }], store);
    assert.equal(compacted[0]?.dataUrl, small);
    assert.equal(compacted[0]?.blobId, undefined);
  });

  it("offloads large images to the store and hydrates them back", async () => {
    assert.equal(shouldOffloadDataUrl(big), true);
    const store = createMemoryBlobStore();
    const compacted = await compactImageRefs([{ dataUrl: big, name: "big.png" }], store);
    assert.equal(compacted[0]?.dataUrl, undefined);
    assert.ok(compacted[0]?.blobId);
    assert.equal(Object.keys(store.dump()).length, 1);

    const hydrated = await hydrateImageRefs(compacted, store);
    assert.equal(hydrated[0]?.dataUrl, big);
    assert.equal(hydrated[0]?.name, "big.png");
  });

  it("keeps legacy inline-only messages working without a blobId", async () => {
    const store = createMemoryBlobStore();
    const ws = {
      chats: [
        {
          messages: [{ images: [{ dataUrl: small, name: "legacy.png" }] }],
        },
      ],
    };
    const compacted = await compactWorkspaceImages(ws, store);
    assert.equal(compacted.chats[0]?.messages[0]?.images?.[0]?.dataUrl, small);
    const hydrated = await hydrateWorkspaceImages(compacted, store);
    assert.equal(hydrated.chats[0]?.messages[0]?.images?.[0]?.dataUrl, small);
  });
});
