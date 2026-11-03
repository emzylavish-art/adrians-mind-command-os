import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectWorkspaceBlobIds,
  compactImageRefs,
  compactWorkspaceImages,
  createMemoryBlobStore,
  decodeJwtSub,
  gcOrphanMediaBlobs,
  hydrateImageRefs,
  hydrateWorkspaceImages,
  INLINE_OFFLOAD_CHARS,
  MEDIA_BLOB_GC_MIN_AGE_MS,
  mediaBlobDbName,
  mediaQuotaWarning,
  MEDIA_QUOTA_SOFT_CHARS,
  newMediaBlobId,
  ownerScopeFromBearer,
  ownerScopeFromUserId,
  shouldOffloadDataUrl,
  type MediaBlobStore,
} from "./blob-store.ts";
import { clearLocalMediaOnSignOut, stripLocalWorkspaceImagePixels } from "./clear-media.ts";
import { classifyGalleryName, listChatGalleryImages } from "./chat-gallery.ts";
import { normalizeWorkspace } from "../workspace.ts";

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
  });

  it("scopes from stable user id via SHA-256, not the raw bearer string", async () => {
    const a = await ownerScopeFromUserId("user-aaa");
    const b = await ownerScopeFromUserId("user-bbb");
    assert.match(a, /^u_[a-f0-9]{16}$/);
    assert.notEqual(a, b);
    assert.equal(await ownerScopeFromUserId(null), "local");
    // Same sub in two JWTs → same scope (token rotation safe)
    const sub = "supabase-user-123";
    const mk = (extra: string) => {
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ sub, nonce: extra })).toString("base64url");
      return `${header}.${payload}.sig`;
    };
    assert.equal(decodeJwtSub(mk("one")), sub);
    assert.equal(await ownerScopeFromBearer(mk("one")), await ownerScopeFromBearer(mk("two")));
    assert.equal(await ownerScopeFromBearer(null), "local");
  });

  it("newMediaBlobId embeds chat id when safe", () => {
    assert.match(newMediaBlobId("chat1"), /^img_chat1_/);
    assert.match(newMediaBlobId("bad id!"), /^img_[a-z0-9-]+$/i);
  });
});

describe("blob GC + quota warning", () => {
  it("does not delete on first observation; deletes only after 2 persists + age", async () => {
    const old = Date.now() - MEDIA_BLOB_GC_MIN_AGE_MS - 1000;
    const store = createMemoryBlobStore();
    await store.put("keep_me", big, old);
    await store.put("orphan_me", small, old);
    const live = collectWorkspaceBlobIds({
      chats: [{ messages: [{ images: [{ blobId: "keep_me" }] }] }],
    });
    const first = await gcOrphanMediaBlobs(store, live, { previouslyUnreferenced: [] });
    assert.equal(first.deleted, 0);
    assert.deepEqual(first.candidates, ["orphan_me"]);
    assert.equal(store.dump().orphan_me, small);

    const second = await gcOrphanMediaBlobs(store, live, {
      previouslyUnreferenced: first.candidates,
      now: Date.now(),
    });
    assert.equal(second.deleted, 1);
    assert.equal(store.dump().keep_me, big);
    assert.equal(store.dump().orphan_me, undefined);
  });

  it("skips GC entirely when skip=true (normalize/load unsafe)", async () => {
    const store = createMemoryBlobStore({ orphan_me: small });
    const result = await gcOrphanMediaBlobs(store, new Set(), {
      previouslyUnreferenced: ["orphan_me"],
      skip: true,
      now: Date.now() + MEDIA_BLOB_GC_MIN_AGE_MS * 2,
    });
    assert.equal(result.deleted, 0);
    assert.equal(store.dump().orphan_me, small);
  });

  it("does not delete young orphans even if seen twice", async () => {
    const store = createMemoryBlobStore();
    await store.put("orphan_me", small, Date.now());
    const live = new Set<string>();
    const first = await gcOrphanMediaBlobs(store, live);
    const second = await gcOrphanMediaBlobs(store, live, {
      previouslyUnreferenced: first.candidates,
      now: Date.now() + 60_000,
    });
    assert.equal(second.deleted, 0);
    assert.equal(store.dump().orphan_me, small);
  });

  it("warns before soft quota is exceeded", () => {
    assert.equal(mediaQuotaWarning(0, 100), undefined);
    assert.ok(mediaQuotaWarning(MEDIA_QUOTA_SOFT_CHARS, 1));
  });
});

describe("refresh → gallery → GC regression (V5-B4)", () => {
  it("normalizeWorkspace keeps images so gallery stays populated and GC does not delete live blobs", async () => {
    const blobId = "img_chat1_liveblob";
    const dataUrl = "data:image/png;base64,aaa";
    const persisted = {
      version: 1,
      chats: [
        {
          id: "chat1",
          title: "Pics",
          memory: "off",
          temporary: false,
          autonomy: "ask",
          projectId: null,
          messages: [
            {
              id: "m1",
              role: "user",
              content: "see this",
              at: new Date(0).toISOString(),
              images: [{ blobId, dataUrl, name: "camera-1.png" }],
            },
          ],
          retrievalLog: [],
        },
      ],
    };
    const normalized = normalizeWorkspace(persisted);
    const images = normalized.chats[0]?.messages[0]?.images;
    assert.ok(images?.length);
    assert.equal(images![0]?.blobId, blobId);
    assert.equal(images![0]?.dataUrl, dataUrl);

    const gallery = listChatGalleryImages(
      normalized.chats[0]!.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        images: msg.images,
      })),
    );
    assert.equal(gallery.length, 1);
    assert.equal(gallery[0]?.kind, "camera");

    const store = createMemoryBlobStore();
    const old = Date.now() - MEDIA_BLOB_GC_MIN_AGE_MS - 1;
    await store.put(blobId, dataUrl, old);
    await store.put("true_orphan", small, old);
    const live = collectWorkspaceBlobIds(normalized);
    assert.ok(live.has(blobId));
    const first = await gcOrphanMediaBlobs(store, live);
    assert.equal(first.deleted, 0);
    const second = await gcOrphanMediaBlobs(store, live, {
      previouslyUnreferenced: first.candidates,
      now: Date.now(),
    });
    assert.equal(store.dump()[blobId], dataUrl, "live blob must survive GC after refresh");
    assert.equal(store.dump().true_orphan, undefined);
    assert.equal(second.deleted, 1);
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
