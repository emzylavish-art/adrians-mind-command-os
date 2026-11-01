/**
 * Client-side image blob store (IndexedDB) to keep large data-URLs out of workspace JSON.
 * Backward compatible: messages with only `dataUrl` continue to work without a blobId.
 */

export const MEDIA_BLOB_DB = "amcos.media.blobs.v1";
export const MEDIA_BLOB_STORE = "images";
/** Offload data-URLs at/above this length into the blob store when persisting. */
export const INLINE_OFFLOAD_CHARS = 80_000;

export type MediaBlobStore = {
  put(id: string, dataUrl: string): Promise<void>;
  get(id: string): Promise<string | undefined>;
  delete?(id: string): Promise<void>;
};

export type ImageRef = {
  dataUrl?: string;
  blobId?: string;
  name?: string;
  mime?: string;
};

export function shouldOffloadDataUrl(dataUrl: string | undefined): boolean {
  return typeof dataUrl === "string" && dataUrl.startsWith("data:image/") && dataUrl.length >= INLINE_OFFLOAD_CHARS;
}

export function newMediaBlobId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `img_${crypto.randomUUID()}`;
  return `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createMemoryBlobStore(seed: Record<string, string> = {}): MediaBlobStore & { dump(): Record<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    async put(id, dataUrl) {
      map.set(id, dataUrl);
    },
    async get(id) {
      return map.get(id);
    },
    async delete(id) {
      map.delete(id);
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const req = indexedDB.open(MEDIA_BLOB_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEDIA_BLOB_STORE)) db.createObjectStore(MEDIA_BLOB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed."));
  });
}

export function createIndexedDbBlobStore(): MediaBlobStore {
  return {
    async put(id, dataUrl) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(MEDIA_BLOB_STORE, "readwrite");
        tx.objectStore(MEDIA_BLOB_STORE).put(dataUrl, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB put failed."));
      });
      db.close();
    },
    async get(id) {
      const db = await openDb();
      const value = await new Promise<string | undefined>((resolve, reject) => {
        const tx = db.transaction(MEDIA_BLOB_STORE, "readonly");
        const req = tx.objectStore(MEDIA_BLOB_STORE).get(id);
        req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : undefined);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed."));
      });
      db.close();
      return value;
    },
    async delete(id) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(MEDIA_BLOB_STORE, "readwrite");
        tx.objectStore(MEDIA_BLOB_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed."));
      });
      db.close();
    },
  };
}

/** Ensure runtime images have dataUrl when a blobId is present. */
export async function hydrateImageRefs(images: ImageRef[] | undefined, store: MediaBlobStore): Promise<ImageRef[]> {
  if (!images?.length) return [];
  const out: ImageRef[] = [];
  for (const image of images) {
    if (image.dataUrl && image.dataUrl.startsWith("data:image/")) {
      out.push({ ...image });
      continue;
    }
    if (image.blobId) {
      const dataUrl = await store.get(image.blobId);
      if (dataUrl) {
        out.push({ ...image, dataUrl });
        continue;
      }
    }
    // Preserve unknown/legacy shapes without inventing pixels.
    out.push({ ...image });
  }
  return out;
}

/**
 * Persist large inline images into the blob store and return compact refs
 * (blobId + name/mime, dataUrl omitted when offloaded).
 */
export async function compactImageRefs(images: ImageRef[] | undefined, store: MediaBlobStore): Promise<ImageRef[]> {
  if (!images?.length) return [];
  const out: ImageRef[] = [];
  for (const image of images) {
    if (image.blobId && image.dataUrl && shouldOffloadDataUrl(image.dataUrl)) {
      await store.put(image.blobId, image.dataUrl);
      out.push({ blobId: image.blobId, name: image.name, mime: image.mime });
      continue;
    }
    if (!image.blobId && shouldOffloadDataUrl(image.dataUrl)) {
      const blobId = newMediaBlobId();
      await store.put(blobId, image.dataUrl!);
      out.push({ blobId, name: image.name, mime: image.mime });
      continue;
    }
    // Small / already-compact / legacy inline-only
    if (image.dataUrl) out.push({ dataUrl: image.dataUrl, blobId: image.blobId, name: image.name, mime: image.mime });
    else if (image.blobId) out.push({ blobId: image.blobId, name: image.name, mime: image.mime });
  }
  return out;
}

export async function hydrateWorkspaceImages<T extends { chats: { messages: { images?: ImageRef[] }[] }[] }>(
  workspace: T,
  store: MediaBlobStore,
): Promise<T> {
  const chats = [];
  for (const chat of workspace.chats) {
    const messages = [];
    for (const msg of chat.messages) {
      if (!msg.images?.length) {
        messages.push(msg);
        continue;
      }
      messages.push({ ...msg, images: await hydrateImageRefs(msg.images, store) });
    }
    chats.push({ ...chat, messages });
  }
  return { ...workspace, chats };
}

export async function compactWorkspaceImages<T extends { chats: { messages: { images?: ImageRef[] }[] }[] }>(
  workspace: T,
  store: MediaBlobStore,
): Promise<T> {
  const chats = [];
  for (const chat of workspace.chats) {
    const messages = [];
    for (const msg of chat.messages) {
      if (!msg.images?.length) {
        messages.push(msg);
        continue;
      }
      messages.push({ ...msg, images: await compactImageRefs(msg.images, store) });
    }
    chats.push({ ...chat, messages });
  }
  return { ...workspace, chats };
}

/** For export: prefer hydrated dataUrl; fall back to blob lookup. */
export async function imagesForExport(images: ImageRef[] | undefined, store: MediaBlobStore): Promise<{ dataUrl: string; name?: string | null }[]> {
  const hydrated = await hydrateImageRefs(images, store);
  return hydrated
    .filter((image): image is ImageRef & { dataUrl: string } => typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/"))
    .map((image) => ({ dataUrl: image.dataUrl, name: image.name ?? null }));
}
