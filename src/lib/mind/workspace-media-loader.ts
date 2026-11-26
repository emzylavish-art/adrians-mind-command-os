import type { MediaBlobStore } from "./media/blob-store.ts";
import type { Chat, MsgImage, Workspace } from "./types.ts";
import { yieldWorkspaceWork } from "./workspace-loader.ts";

export type WorkspaceImagePatch = { chatId: string; messageId: string; imageIndex: number; blobId: string; dataUrl?: string };
export type WorkspaceMediaProgress = { total: number; completed: number; missing: number };

function references(chats: readonly Chat[]): WorkspaceImagePatch[] {
  return chats.flatMap((chat) => chat.messages.flatMap((message) => (message.images ?? []).flatMap((image, imageIndex) => image.blobId && !image.dataUrl ? [{ chatId: chat.id, messageId: message.id, imageIndex, blobId: image.blobId }] : [])));
}

/** Merge pixels only. Never revive a deleted chat or replace edits, metadata, ownership or tombstones. */
export function applyWorkspaceImagePatches(workspace: Workspace, patches: readonly WorkspaceImagePatch[], remember?: (image: MsgImage) => void): Workspace {
  const lookup = new Map(patches.filter((patch) => patch.dataUrl?.startsWith("data:image/")).map((patch) => [JSON.stringify([patch.chatId, patch.messageId, patch.imageIndex, patch.blobId]), patch]));
  if (!lookup.size) return workspace;
  let changed = false;
  const chats = workspace.chats.map((chat) => {
    let chatChanged = false;
    const messages = chat.messages.map((message) => {
      if (!message.images?.length) return message;
      let messageChanged = false;
      const images = message.images.map((image, index) => {
        if (image.dataUrl || !image.blobId) return image;
        const patch = lookup.get(JSON.stringify([chat.id, message.id, index, image.blobId]));
        if (!patch?.dataUrl) return image;
        messageChanged = true;
        const hydrated = { ...image, dataUrl: patch.dataUrl }; remember?.(hydrated); return hydrated;
      });
      if (!messageChanged) return message;
      chatChanged = true; return { ...message, images };
    });
    if (!chatChanged) return chat;
    changed = true; return { ...chat, messages };
  });
  return changed ? { ...workspace, chats } : workspace;
}

/** One owner-bound cache shares in-flight reads between background hydration and active-chat dispatch. */
export function createWorkspaceMediaLoader(store: MediaBlobStore) {
  const cached = new Map<string, Promise<string | undefined>>();
  const read = (id: string) => {
    let pending = cached.get(id);
    if (!pending) { pending = store.get(id).then((value) => value?.startsWith("data:image/") ? value : undefined).catch(() => undefined); cached.set(id, pending); void pending.finally(() => { if (cached.get(id) === pending) cached.delete(id); }); }
    return pending;
  };
  const hydrate = (items: WorkspaceImagePatch[]) => Promise.all(items.map(async (item) => ({ ...item, dataUrl: await read(item.blobId) })));
  async function chatPatches(chat: Chat, isCurrent = () => true): Promise<WorkspaceImagePatch[]> {
    const queued = references([chat]); const patches: WorkspaceImagePatch[] = [];
    while (queued.length && isCurrent()) {
      const batch = await hydrate(queued.splice(0, 8));
      if (!isCurrent()) break;
      patches.push(...batch);
      if (queued.length) await yieldWorkspaceWork();
    }
    return patches;
  }
  async function progressively(workspace: Workspace, options: { isCurrent: () => boolean; onBatch: (patches: WorkspaceImagePatch[], progress: WorkspaceMediaProgress) => void; priorityChatId?: () => string | null; batchSize?: number; yieldControl?: () => Promise<void> }) {
    const pending = references(workspace.chats); const progress: WorkspaceMediaProgress = { total: pending.length, completed: 0, missing: 0 };
    const batchSize = Math.max(1, Math.min(16, options.batchSize ?? 8));
    while (pending.length && options.isCurrent()) {
      await (options.yieldControl ?? yieldWorkspaceWork)(); if (!options.isCurrent()) break;
      const priority = options.priorityChatId?.();
      if (priority) pending.sort((a, b) => Number(b.chatId === priority) - Number(a.chatId === priority));
      const patches = await hydrate(pending.splice(0, batchSize));
      if (!options.isCurrent()) break;
      progress.completed += patches.length; progress.missing += patches.filter((patch) => !patch.dataUrl).length;
      options.onBatch(patches, { ...progress });
    }
    return { ...progress, cancelled: !options.isCurrent() };
  }
  return { chatPatches, progressively };
}
