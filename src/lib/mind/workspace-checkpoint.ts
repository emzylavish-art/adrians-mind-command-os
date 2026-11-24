import type { MsgImage, Workspace } from "./types.ts";
import { compactWorkspaceImages, hydrateWorkspaceImages, type MediaBlobStore } from "./media/blob-store.ts";

/** Reuse only blob IDs whose bytes were successfully written for this exact image. */
export function createWorkspaceCheckpoint() {
  const storedImages = new WeakMap<MsgImage, MsgImage>();

  function snapshot(ws: Workspace): Workspace {
    return {
      ...ws,
      chats: ws.chats.map((chat) => ({
        ...chat,
        messages: chat.messages.map((msg) => msg.images?.length
          ? { ...msg, images: msg.images.map((image) => storedImages.get(image) ?? image) }
          : msg),
      })),
    };
  }

  async function compact(ws: Workspace, store: MediaBlobStore): Promise<Workspace> {
    const compacted = await compactWorkspaceImages(snapshot(ws), store);
    compacted.chats.forEach((chat, c) => chat.messages.forEach((msg, m) => {
      msg.images?.forEach((ref, i) => {
        if (ref.blobId && !ref.dataUrl) storedImages.set(ws.chats[c].messages[m].images![i], ref);
      });
    }));
    return compacted;
  }

  async function hydrate(ws: Workspace, store: MediaBlobStore): Promise<Workspace> {
    const hydrated = await hydrateWorkspaceImages(ws, store);
    ws.chats.forEach((chat, c) => chat.messages.forEach((msg, m) => {
      msg.images?.forEach((ref, i) => {
        if (ref.blobId && !ref.dataUrl) storedImages.set(hydrated.chats[c].messages[m].images![i], ref);
      });
    }));
    return hydrated;
  }

  return { snapshot, compact, hydrate };
}
