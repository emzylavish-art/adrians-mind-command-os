import { accountPreferenceKey } from "./account-preferences.ts";
import { buildDraftKey } from "./kimi/build-review.ts";
import { researchArchiveKey } from "./research-reports.ts";
import type { Workspace } from "./types.ts";

export const LOCAL_RETENTION_TARGETS = ["originals", "images", "videos", "knowledge", "research", "build-recovery", "preferences", "composer-drafts"] as const;
export type LocalRetentionTarget = typeof LOCAL_RETENTION_TARGETS[number];
type KeyStorage = Pick<Storage, "getItem" | "removeItem" | "key" | "length">;
export type RetentionReceipt = { target: LocalRetentionTarget; state: "locally-cleared" | "failed"; detail: string; at: string };
export const RETENTION_DESCRIPTIONS: Record<LocalRetentionTarget, { name: string; scope: string; retained: string }> = {
  originals: { name: "Original documents on this device", scope: "Original-file blobs for this account in this browser.", retained: "Library entries, extracted previews, server snapshots and files downloaded elsewhere remain." },
  images: { name: "Image copies on this device", scope: "Image blobs for this account in this browser.", retained: "Message text, image references, inline copies, external providers and downloaded files remain." },
  videos: { name: "Video copies on this device", scope: "Video blobs explicitly saved for this account in this browser.", retained: "Chat links, job receipts, server recovery records, external providers and downloaded files remain." },
  knowledge: { name: "Local knowledge indexes", scope: "Document passage indexes for this account on this device.", retained: "Original documents, Library entries and selected document references remain." },
  research: { name: "Research archive on this device", scope: "Saved research reports and their versions for this account in this browser.", retained: "Excerpts already attached to chats, exported reports and external source pages remain." },
  "build-recovery": { name: "Build recovery on this device", scope: "Local editor drafts, last-job pointer and result receipt for this account.", retained: "Saved project files, accepted server jobs, repository code and server execution records remain." },
  preferences: { name: "Browser preferences for this account", scope: "Provider choices, layout and other account-scoped settings saved in this browser.", retained: "Server credentials, account memory suspension and provider connections remain. Reload to apply default preferences." },
  "composer-drafts": { name: "Drafts in this tab", scope: "Saved and currently mounted composer drafts for this account in this tab, including temporary draft fields.", retained: "Already sent messages and another tab's drafts remain." },
};

function removePrefix(storage: KeyStorage, prefix: string) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (key?.startsWith(prefix)) keys.push(key); }
  for (const key of keys) storage.removeItem(key);
}

/** Only the explicitly selected local stores are removed. No network/account deletion operation is hidden here. */
export async function clearLocalRetention(ownerId: string, targets: LocalRetentionTarget[], deps: { local: KeyStorage; session: KeyStorage; originals: { clear(): Promise<void> }; images: { clear(): Promise<void> }; videos: { clear(): Promise<void> }; knowledge: { clear(): Promise<void> }; afterDraftClear?: () => void; now?: () => string }): Promise<RetentionReceipt[]> {
  if (!ownerId) throw new Error("An account is required before clearing local data.");
  if (targets.some((target) => !(LOCAL_RETENTION_TARGETS as readonly string[]).includes(target))) throw new Error("Unknown local data category. Nothing was removed.");
  const receipts: RetentionReceipt[] = [];
  for (const target of [...new Set(targets)]) {
    try {
      if (target === "originals" || target === "images" || target === "videos" || target === "knowledge") await deps[target].clear();
      if (target === "research") deps.local.removeItem(researchArchiveKey(ownerId));
      if (target === "build-recovery") {
        for (const key of [buildDraftKey(ownerId), `amcos.build-result.v1.${encodeURIComponent(ownerId)}`, `adrian-build-last-job.${ownerId}`]) deps.local.removeItem(key);
        deps.session.removeItem(buildDraftKey(ownerId));
        deps.session.removeItem(`adrian-build-draft.${ownerId}`);
        deps.session.removeItem(`adrian-build-task-source.${ownerId}`);
        deps.session.removeItem(`adrian-build-mode.${ownerId}`);
        deps.session.removeItem(`adrian-human-return.${ownerId}`);
      }
      if (target === "preferences") removePrefix(deps.local, accountPreferenceKey(ownerId, ""));
      if (target === "composer-drafts") { removePrefix(deps.session, "amcos.draft.v1.[" + JSON.stringify(ownerId) + ","); deps.afterDraftClear?.(); }
      receipts.push({ target, state: "locally-cleared", detail: `${RETENTION_DESCRIPTIONS[target].name} acknowledged removal. ${RETENTION_DESCRIPTIONS[target].retained}`, at: deps.now?.() ?? new Date().toISOString() });
    } catch { receipts.push({ target, state: "failed", detail: `${RETENTION_DESCRIPTIONS[target].name} did not acknowledge complete removal. Close other tabs and retry this category.`, at: deps.now?.() ?? new Date().toISOString() }); }
  }
  return receipts;
}

export function verifyDeletionAcknowledgement(local: Workspace, server: Workspace | null) {
  const chats = local.deletedChatIds ?? [];
  const memories = local.deletedMemoryIds ?? [];
  const serverChats = new Set(server?.deletedChatIds ?? []);
  const serverMemories = new Set(server?.deletedMemoryIds ?? []);
  const confirmedChatIds = chats.filter((id) => serverChats.has(id) && !server?.chats.some((chat) => chat.id === id));
  const confirmedMemoryIds = memories.filter((id) => serverMemories.has(id) && !server?.memories.some((note) => note.id === id));
  return { locallyRemoved: chats.length + memories.length, confirmedChatIds, confirmedMemoryIds, pendingChatIds: chats.filter((id) => !confirmedChatIds.includes(id)), pendingMemoryIds: memories.filter((id) => !confirmedMemoryIds.includes(id)), scope: "Current managed server snapshot only. Offline devices, exports, backups and provider retention are not verified by this check." };
}
