import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectWorkspaceBlobIds,
  compactImageRefs,
  compactWorkspaceImages,
  createMemoryBlobStore,
  gcOrphanMediaBlobs,
  hydrateImageRefs,
  hydrateWorkspaceImages,
  INLINE_OFFLOAD_CHARS,
  mediaBlobDbName,
  mediaQuotaWarning,
  MEDIA_QUOTA_SOFT_CHARS,
  newMediaBlobId,
  ownerScopeFromBearer,
  shouldOffloadDataUrl,
  type MediaBlobStore,
} from "./blob-store.ts";
import { clearLocalMediaOnSignOut, stripLocalWorkspaceImagePixels } from "./clear-media.ts";
import { classifyGalleryName, listChatGalleryImages } from "./chat-gallery.ts";

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

  it("prefixes new blob ids with chatId for isolation/GC", async () => {
    const store = createMemoryBlobStore();
    const ws: { chats: { id: string; messages: { images?: { dataUrl?: string; blobId?: string; name?: string }[] }[] }[] } = {
      chats: [{ id: "chatABC", messages: [{ images: [{ dataUrl: big, name: "scoped.png" }] }] }],
    };
    const compacted = await compactWorkspaceImages(ws, store);
    const blobId = compacted.chats[0]?.messages[0]?.images?.[0]?.blobId;
    assert.ok(blobId?.startsWith("img_chatABC_"));
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

describe("isolation: owner scope + DB names", () => {
  it("keeps legacy DB name for local scope and scopes others", () => {
    assert.equal(mediaBlobDbName("local"), "amcos.media.blobs.v1");
    assert.equal(mediaBlobDbName("u_abc"), "amcos.media.blobs.v1.u_abc");
    assert.notEqual(ownerScopeFromBearer("token-a"), ownerScopeFromBearer("token-b"));
    assert.equal(ownerScopeFromBearer(null), "local");
  });

  it("newMediaBlobId embeds chat id when safe", () => {
    assert.match(newMediaBlobId("chat1"), /^img_chat1_/);
    assert.match(newMediaBlobId("bad id!"), /^img_[a-z0-9-]+$/i);
  });
});

describe("blob GC + quota warning", () => {
  it("deletes orphans not referenced by workspace messages", async () => {
    const store = createMemoryBlobStore({ keep_me: big, orphan_me: small });
    const live = collectWorkspaceBlobIds({
      chats: [{ messages: [{ images: [{ blobId: "keep_me" }] }] }],
    });
    const result = await gcOrphanMediaBlobs(store, live);
    assert.equal(result.deleted, 1);
    assert.equal(store.dump().keep_me, big);
    assert.equal(store.dump().orphan_me, undefined);
  });

  it("warns before soft quota is exceeded", () => {
    assert.equal(mediaQuotaWarning(0, 100), undefined);
    assert.ok(mediaQuotaWarning(MEDIA_QUOTA_SOFT_CHARS, 1));
  });
});

describe("clear local media on sign-out", () => {
  it("strips workspace image pixels without touching message text", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
      removeItem: (key: string) => {
        mem.delete(key);
      },
    };
    storage.setItem(
      "amcos.workspace.v1",
      JSON.stringify({
        chats: [
          {
            id: "c1",
            messages: [
              { id: "m1", content: "hello", images: [{ dataUrl: small, blobId: "b1", name: "x.png" }] },
            ],
          },
        ],
      }),
    );
    assert.equal(stripLocalWorkspaceImagePixels(storage), true);
    const parsed = JSON.parse(storage.getItem("amcos.workspace.v1")!);
    assert.equal(parsed.chats[0].messages[0].content, "hello");
    assert.deepEqual(parsed.chats[0].messages[0].images, []);
  });

  it("clearLocalMediaOnSignOut clears owner scope and strips workspace", async () => {
    const session = new Map<string, string>([["amcos.media.ownerScope", "u_test"]]);
    const local = new Map<string, string>([
      [
        "amcos.workspace.v1",
        JSON.stringify({ chats: [{ messages: [{ content: "a", images: [{ dataUrl: small }] }] }] }),
      ],
    ]);
    const deleted: string[] = [];
    const fakeIdb = {
      deleteDatabase(name: string) {
        deleted.push(name);
        return {
          set onsuccess(fn: () => void) {
            fn();
          },
          set onerror(_fn: () => void) {},
          set onblocked(_fn: () => void) {},
        };
      },
    } as unknown as IDBFactory;

    const result = await clearLocalMediaOnSignOut({
      indexedDB: fakeIdb,
      sessionStorage: {
        getItem: (key) => session.get(key) ?? null,
        removeItem: (key) => {
          session.delete(key);
        },
      },
      localStorage: {
        getItem: (key) => local.get(key) ?? null,
        setItem: (key, value) => {
          local.set(key, value);
        },
        removeItem: (key) => {
          local.delete(key);
        },
      },
    });
    assert.equal(result.clearedScope, "u_test");
    assert.equal(result.strippedWorkspace, true);
    assert.equal(session.has("amcos.media.ownerScope"), false);
    assert.ok(deleted.includes("amcos.media.blobs.v1"));
    assert.ok(deleted.includes("amcos.media.blobs.v1.u_test"));
  });
});

describe("per-chat gallery listing", () => {
  it("lists only hydrated images for the given messages", () => {
    const items = listChatGalleryImages([
      {
        id: "m1",
        role: "user",
        images: [
          { dataUrl: small, name: "camera-1.png" },
          { blobId: "missing" },
          { dataUrl: "https://evil.example/x.png", name: "nope" },
        ],
      },
      {
        id: "m2",
        role: "assistant",
        images: [{ dataUrl: small, name: "generated-2.png" }],
      },
    ]);
    assert.equal(items.length, 2);
    assert.equal(items[0]?.kind, "camera");
    assert.equal(items[1]?.kind, "generated");
    assert.equal(classifyGalleryName("photo.png", "user"), "attached");
  });
});
