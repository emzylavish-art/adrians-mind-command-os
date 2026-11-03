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
  type MediaBlobStore,
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

describe("adversarial: blob store degrade", () => {
  it("keeps a placeholder when the blob is missing on hydrate", async () => {
    const store = createMemoryBlobStore();
    const hydrated = await hydrateImageRefs([{ blobId: "missing_blob", name: "gone.png" }], store);
    assert.equal(hydrated[0]?.dataUrl, undefined);
    assert.equal(hydrated[0]?.blobId, "missing_blob");
  });

  it("falls back to inline when put throws QuotaExceededError", async () => {
    const store: MediaBlobStore = {
      async put() {
        const err = new Error("QuotaExceededError");
        (err as Error & { name: string }).name = "QuotaExceededError";
        throw err;
      },
      async get() {
        return undefined;
      },
    };
    const bigLocal = `data:image/png;base64,${"b".repeat(INLINE_OFFLOAD_CHARS)}`;
    const compacted = await compactImageRefs([{ dataUrl: bigLocal, name: "q.png" }], store);
    assert.equal(compacted[0]?.dataUrl, bigLocal);
  });
});

describe("adversarial: compact/hydrate races and reload", () => {
  it("survives interleaved compact and hydrate on the same blobId", async () => {
    const store = createMemoryBlobStore();
    const bigLocal = `data:image/png;base64,${"c".repeat(INLINE_OFFLOAD_CHARS)}`;
    const first = compactImageRefs([{ dataUrl: bigLocal, name: "race.png" }], store);
    const second = compactImageRefs([{ dataUrl: bigLocal, name: "race.png" }], store);
    const [a, b] = await Promise.all([first, second]);
    assert.ok(a[0]?.blobId);
    assert.ok(b[0]?.blobId);
    const hydrated = await hydrateImageRefs([{ blobId: a[0]!.blobId!, name: "race.png" }], store);
    assert.equal(hydrated[0]?.dataUrl, bigLocal);
  });

  it("reload simulation: compact, drop inline, hydrate again", async () => {
    const store = createMemoryBlobStore();
    const bigLocal = `data:image/png;base64,${"d".repeat(INLINE_OFFLOAD_CHARS)}`;
    const compacted = await compactImageRefs([{ dataUrl: bigLocal, name: "reload.png" }], store);
    // Simulate reload: only blobId persisted in workspace JSON
    const persisted = [{ blobId: compacted[0]!.blobId!, name: "reload.png", mime: "image/png" }];
    const hydrated = await hydrateImageRefs(persisted, store);
    assert.equal(hydrated[0]?.dataUrl, bigLocal);
    assert.equal(hydrated[0]?.name, "reload.png");
  });
});
