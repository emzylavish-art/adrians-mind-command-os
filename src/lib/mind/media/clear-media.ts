/**
 * Clear local media caches on sign-out / identity switch.
 * Never deletes cloud media — IndexedDB + localStorage image pixels only.
 */

import {
  clearMediaOwnerScope,
  deleteMediaBlobDatabase,
  MEDIA_BLOB_DB,
  readMediaOwnerScope,
} from "./blob-store.ts";

/** Same key as workspace.ts — duplicated to avoid pulling React workspace into auth. */
export const WORKSPACE_STORAGE_KEY = "amcos.workspace.v1";

export type ClearLocalMediaOptions = {
  indexedDB?: IDBFactory | null;
  sessionStorage?: Pick<Storage, "getItem" | "removeItem"> | null;
  localStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  /** Extra owner scopes to wipe (always includes current + legacy `local`). */
  extraScopes?: string[];
};

/**
 * Strip image pixels / blobIds from the browser workspace copy so a later
 * session cannot hydrate another user's (or prior session's) local images.
 * Message text is preserved. Cloud assets are untouched.
 */
export function stripLocalWorkspaceImagePixels(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
  key = WORKSPACE_STORAGE_KEY,
): boolean {
  if (!storage) return false;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as {
      chats?: { messages?: { images?: unknown[] }[] }[];
    };
    if (!parsed || !Array.isArray(parsed.chats)) return false;
    let changed = false;
    for (const chat of parsed.chats) {
      if (!chat?.messages) continue;
      for (const msg of chat.messages) {
        if (!msg?.images?.length) continue;
        msg.images = [];
        changed = true;
      }
    }
    if (changed) storage.setItem(key, JSON.stringify(parsed));
    return changed;
  } catch {
    return false;
  }
}

async function deleteDb(factory: IDBFactory | null | undefined, name: string): Promise<void> {
  if (!factory) return;
  await new Promise<void>((resolve) => {
    try {
      const req = factory.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Clear local media on sign-out:
 * 1. Delete scoped + legacy IndexedDB blob DBs
 * 2. Strip image refs from localStorage workspace
 * 3. Clear media owner scope session key
 *
 * Does NOT call any cloud API and does NOT delete remote objects.
 */
export async function clearLocalMediaOnSignOut(options: ClearLocalMediaOptions = {}): Promise<{
  clearedScope: string;
  strippedWorkspace: boolean;
}> {
  const session =
    options.sessionStorage !== undefined
      ? options.sessionStorage
      : typeof sessionStorage !== "undefined"
        ? sessionStorage
        : null;
  const local =
    options.localStorage !== undefined
      ? options.localStorage
      : typeof localStorage !== "undefined"
        ? localStorage
        : null;
  const factory =
    options.indexedDB !== undefined
      ? options.indexedDB
      : typeof indexedDB !== "undefined"
        ? indexedDB
        : null;

  const scope = readMediaOwnerScope(session);
  const scopes = new Set<string>(["local", scope, ...(options.extraScopes ?? [])]);

  for (const item of scopes) {
    if (item === "local") {
      await deleteDb(factory, MEDIA_BLOB_DB);
      // Also use helper for symmetry when factory is the real one.
      if (!factory) await deleteMediaBlobDatabase("local");
    } else {
      await deleteDb(factory, `${MEDIA_BLOB_DB}.${item}`);
      if (!factory) await deleteMediaBlobDatabase(item);
    }
  }

  const strippedWorkspace = stripLocalWorkspaceImagePixels(local);
  clearMediaOwnerScope(session);
  return { clearedScope: scope, strippedWorkspace };
}
