/**
 * Client-side image blob store (IndexedDB) to keep large data-URLs out of workspace JSON.
 * Backward compatible: messages with only `dataUrl` continue to work without a blobId.
 *
 * Isolation: DB name is scoped by media owner (`local` or `u_<hash>` from bearer).
 * Blob ids may include a chatId prefix so orphans can be GC'd per chat.
 * Never touches cloud media — local IndexedDB only.
 */

export const MEDIA_BLOB_DB = "amcos.media.blobs.v1";
export const MEDIA_BLOB_STORE = "images";
export const MEDIA_OWNER_SCOPE_KEY = "amcos.media.ownerScope";
/** Offload data-URLs at/above this length into the blob store when persisting. */
export const INLINE_OFFLOAD_CHARS = 80_000;
/** Soft ceiling on summed data-URL chars in IDB before we warn (before QuotaExceeded). */
export const MEDIA_QUOTA_SOFT_CHARS = 32_000_000;

export type MediaBlobStore = {
  put(id: string, dataUrl: string): Promise<void>;
  get(id: string): Promise<string | undefined>;
  delete?(id: string): Promise<void>;
  listIds?(): Promise<string[]>;
  clearAll?(): Promise<void>;
  estimateChars?(): Promise<number>;
};

export type ImageRef = {
  dataUrl?: string;
  blobId?: string;
  name?: string;
  mime?: string;
};

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name) : "";
  const message = "message" in error ? String((error as { message?: unknown }).message) : "";
  return name === "QuotaExceededError" || /quota/i.test(message);
}

export type CompactResult = { refs: ImageRef[]; degraded: boolean; warning?: string };

export function shouldOffloadDataUrl(dataUrl: string | undefined): boolean {
  return typeof dataUrl === "string" && dataUrl.startsWith("data:image/") && dataUrl.length >= INLINE_OFFLOAD_CHARS;
}

/** Sanitize owner scope for use in IndexedDB database names. */
export function sanitizeMediaOwnerScope(ownerScope: string | null | undefined): string {
  const raw = (ownerScope ?? "local").trim() || "local";
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return safe || "local";
}

/**
 * IndexedDB name for a media owner. The default `local` scope keeps the legacy
 * unscoped DB name so existing installs keep resolving blobs.
 */
export function mediaBlobDbName(ownerScope: string | null | undefined = "local"): string {
  const safe = sanitizeMediaOwnerScope(ownerScope);
  if (safe === "local") return MEDIA_BLOB_DB;
  return `${MEDIA_BLOB_DB}.${safe}`;
}

/** Stable non-reversible scope id from a bearer token (or `local` when absent). */
export function ownerScopeFromBearer(token: string | null | undefined): string {
  if (!token) return "local";
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `u_${(h >>> 0).toString(36)}`;
}

export function readMediaOwnerScope(
  storage: Pick<Storage, "getItem"> | null | undefined =
    typeof sessionStorage !== "undefined" ? sessionStorage : null,
): string {
  try {
    const value = storage?.getItem(MEDIA_OWNER_SCOPE_KEY);
    return sanitizeMediaOwnerScope(value);
  } catch {
    return "local";
  }
}

export function writeMediaOwnerScope(
  scope: string,
  storage: Pick<Storage, "setItem"> | null | undefined =
    typeof sessionStorage !== "undefined" ? sessionStorage : null,
): void {
  try {
    storage?.setItem(MEDIA_OWNER_SCOPE_KEY, sanitizeMediaOwnerScope(scope));
  } catch {
    /* private mode */
  }
}

export function clearMediaOwnerScope(
  storage: Pick<Storage, "removeItem"> | null | undefined =
    typeof sessionStorage !== "undefined" ? sessionStorage : null,
): void {
  try {
    storage?.removeItem(MEDIA_OWNER_SCOPE_KEY);
  } catch {
    /* private mode */
  }
}

export function newMediaBlobId(chatId?: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  if (chatId && /^[a-zA-Z0-9_-]{1,64}$/.test(chatId)) return `img_${chatId}_${rand}`;
  return `img_${rand}`;
}

/** Soft warning before IndexedDB writes are likely to hit QuotaExceeded. */
export function mediaQuotaWarning(currentChars: number, incomingChars = 0): string | undefined {
  if (currentChars + incomingChars >= MEDIA_QUOTA_SOFT_CHARS) {
    return "Local image cache is nearly full. Unused images will be cleared, or attach smaller images.";
  }
  return undefined;
}

export function createMemoryBlobStore(
  seed: Record<string, string> = {},
): MediaBlobStore & { dump(): Record<string, string> } {
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
    async listIds() {
      return [...map.keys()];
    },
    async clearAll() {
      map.clear();
    },
    async estimateChars() {
      let total = 0;
      for (const value of map.values()) total += value.length;
      return total;
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEDIA_BLOB_STORE)) db.createObjectStore(MEDIA_BLOB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed."));
  });
}

export function createIndexedDbBlobStore(ownerScope: string | null | undefined = "local"): MediaBlobStore {
  const dbName = mediaBlobDbName(ownerScope);
  return {
    async put(id, dataUrl) {
      const db = await openDb(dbName);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(MEDIA_BLOB_STORE, "readwrite");
        tx.objectStore(MEDIA_BLOB_STORE).put(dataUrl, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB put failed."));
      });
      db.close();
    },
    async get(id) {
      const db = await openDb(dbName);
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
      const db = await openDb(dbName);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(MEDIA_BLOB_STORE, "readwrite");
        tx.objectStore(MEDIA_BLOB_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed."));
      });
      db.close();
    },
    async listIds() {
      const db = await openDb(dbName);
      const ids = await new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(MEDIA_BLOB_STORE, "readonly");
        const req = tx.objectStore(MEDIA_BLOB_STORE).getAllKeys();
        req.onsuccess = () => resolve((req.result as IDBValidKey[]).map((key) => String(key)));
        req.onerror = () => reject(req.error ?? new Error("IndexedDB list failed."));
      });
      db.close();
      return ids;
    },
    async clearAll() {
      const db = await openDb(dbName);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(MEDIA_BLOB_STORE, "readwrite");
        tx.objectStore(MEDIA_BLOB_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed."));
      });
      db.close();
    },
    async estimateChars() {
      const db = await openDb(dbName);
      const total = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(MEDIA_BLOB_STORE, "readonly");
        const req = tx.objectStore(MEDIA_BLOB_STORE).getAll();
        req.onsuccess = () => {
          const rows = req.result as unknown[];
          let sum = 0;
          for (const row of rows) {
            if (typeof row === "string") sum += row.length;
          }
          resolve(sum);
        };
        req.onerror = () => reject(req.error ?? new Error("IndexedDB estimate failed."));
      });
      db.close();
      return total;
    },
  };
}

/** Best-effort delete of a media blob database (local only). */
export function deleteMediaBlobDatabase(ownerScope: string | null | undefined = "local"): Promise<void> {
  const dbName = mediaBlobDbName(ownerScope);
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve();
      return;
    }
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
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
      try {
        const dataUrl = await store.get(image.blobId);
        if (dataUrl) {
          out.push({ ...image, dataUrl });
          continue;
        }
        // Missing blob on reload — keep the ref so UI can show an honest placeholder.
        out.push({ blobId: image.blobId, name: image.name, mime: image.mime });
        continue;
      } catch {
        out.push({ blobId: image.blobId, name: image.name, mime: image.mime });
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
export async function compactImageRefs(
  images: ImageRef[] | undefined,
  store: MediaBlobStore,
  options: { chatId?: string } = {},
): Promise<ImageRef[]> {
  const detailed = await compactImageRefsDetailed(images, store, options);
  return detailed.refs;
}

export async function compactImageRefsDetailed(
  images: ImageRef[] | undefined,
  store: MediaBlobStore,
  options: { chatId?: string } = {},
): Promise<CompactResult> {
  if (!images?.length) return { refs: [], degraded: false };
  const out: ImageRef[] = [];
  let degraded = false;
  let warning: string | undefined;
  let estimated =
    typeof store.estimateChars === "function"
      ? await store.estimateChars().catch(() => 0)
      : 0;

  for (const image of images) {
    if (image.blobId && image.dataUrl && shouldOffloadDataUrl(image.dataUrl)) {
      const soft = mediaQuotaWarning(estimated, image.dataUrl.length);
      if (soft) warning = soft;
      try {
        await store.put(image.blobId, image.dataUrl);
        estimated += image.dataUrl.length;
        out.push({ blobId: image.blobId, name: image.name, mime: image.mime });
      } catch (error) {
        degraded = true;
        out.push({ dataUrl: image.dataUrl, blobId: image.blobId, name: image.name, mime: image.mime });
        if (isQuotaExceededError(error)) {
          warning = "Local image cache is full. Keeping this image inline; free space or clear unused media.";
        }
      }
      continue;
    }
    if (!image.blobId && shouldOffloadDataUrl(image.dataUrl)) {
      const blobId = newMediaBlobId(options.chatId);
      const soft = mediaQuotaWarning(estimated, image.dataUrl!.length);
      if (soft) warning = soft;
      try {
        await store.put(blobId, image.dataUrl!);
        estimated += image.dataUrl!.length;
        out.push({ blobId, name: image.name, mime: image.mime });
      } catch (error) {
        degraded = true;
        out.push({ dataUrl: image.dataUrl, name: image.name, mime: image.mime });
        if (isQuotaExceededError(error)) {
          warning = "Local image cache is full. Keeping this image inline; free space or clear unused media.";
        }
      }
      continue;
    }
    // Small / already-compact / legacy inline-only
    if (image.dataUrl) out.push({ dataUrl: image.dataUrl, blobId: image.blobId, name: image.name, mime: image.mime });
    else if (image.blobId) out.push({ blobId: image.blobId, name: image.name, mime: image.mime });
  }
  return { refs: out, degraded, warning };
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

export async function compactWorkspaceImages<T extends { chats: ({ id?: string } & { messages: { images?: ImageRef[] }[] })[] }>(
  workspace: T,
  store: MediaBlobStore,
): Promise<T> {
  const detailed = await compactWorkspaceImagesDetailed(workspace, store);
  return detailed.workspace;
}

export async function compactWorkspaceImagesDetailed<
  T extends { chats: ({ id?: string } & { messages: { images?: ImageRef[] }[] })[] },
>(workspace: T, store: MediaBlobStore): Promise<{ workspace: T; degraded: boolean; warning?: string }> {
  const chats = [];
  let degraded = false;
  let warning: string | undefined;
  for (const chat of workspace.chats) {
    const messages = [];
    for (const msg of chat.messages) {
      if (!msg.images?.length) {
        messages.push(msg);
        continue;
      }
      const result = await compactImageRefsDetailed(msg.images, store, { chatId: chat.id });
      if (result.degraded) degraded = true;
      if (result.warning) warning = result.warning;
      messages.push({ ...msg, images: result.refs });
    }
    chats.push({ ...chat, messages });
  }
  return { workspace: { ...workspace, chats }, degraded, warning };
}

/** Collect every blobId still referenced by workspace messages. */
export function collectWorkspaceBlobIds(
  workspace: { chats: { messages: { images?: ImageRef[] }[] }[] },
): Set<string> {
  const live = new Set<string>();
  for (const chat of workspace.chats) {
    for (const msg of chat.messages) {
      for (const image of msg.images ?? []) {
        if (image.blobId) live.add(image.blobId);
      }
    }
  }
  return live;
}

/**
 * Delete IndexedDB blobs that no message references. Local only — never cloud.
 */
export async function gcOrphanMediaBlobs(
  store: MediaBlobStore,
  liveIds: Set<string>,
): Promise<{ deleted: number; remaining: number }> {
  if (typeof store.listIds !== "function" || typeof store.delete !== "function") {
    return { deleted: 0, remaining: liveIds.size };
  }
  const ids = await store.listIds();
  let deleted = 0;
  for (const id of ids) {
    if (liveIds.has(id)) continue;
    try {
      await store.delete(id);
      deleted += 1;
    } catch {
      /* best effort */
    }
  }
  return { deleted, remaining: ids.length - deleted };
}

/** For export: prefer hydrated dataUrl; fall back to blob lookup. */
export async function imagesForExport(
  images: ImageRef[] | undefined,
  store: MediaBlobStore,
): Promise<{ dataUrl: string; name?: string | null }[]> {
  const hydrated = await hydrateImageRefs(images, store);
  return hydrated
    .filter((image): image is ImageRef & { dataUrl: string } => typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/"))
    .map((image) => ({ dataUrl: image.dataUrl, name: image.name ?? null }));
}

/** Prefer IndexedDB; fall back to memory when private mode / no IDB. */
export function tryCreateIndexedDbBlobStore(ownerScope?: string | null): MediaBlobStore {
  if (typeof indexedDB === "undefined") return createMemoryBlobStore();
  try {
    return createIndexedDbBlobStore(ownerScope ?? readMediaOwnerScope());
  } catch {
    return createMemoryBlobStore();
  }
}
