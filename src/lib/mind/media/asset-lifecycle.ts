import { hydrateWorkspaceImages, type ImageRef, type MediaBlobStore } from "./blob-store.ts";

/** Content identity is stable across exports; editing creates a new immutable asset. */
export async function assetIdentity(dataUrl: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
  return `asset-${Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export async function identifyImages<T extends ImageRef>(images: T[], input: { operationId?: string; parent?: string; editPrompt?: string } = {}): Promise<Array<T & ImageRef>> {
  const parentAssetId = input.parent ? await assetIdentity(input.parent) : undefined;
  return Promise.all(images.map(async (image) => ({ ...image,
    assetId: image.assetId ?? (image.dataUrl ? await assetIdentity(image.dataUrl) : undefined),
    createdAt: image.createdAt ?? new Date().toISOString(),
    ...(input.operationId ? { operationId: input.operationId } : {}),
    ...(parentAssetId ? { parentAssetId } : {}),
    ...(input.editPrompt ? { editPrompt: input.editPrompt } : {}),
  })));
}

type Exportable = { chats: { id: string; messages: { id: string; images?: ImageRef[]; videoUrl?: string }[] }[] };
export async function prepareMediaExport<T extends Exportable>(workspace: T, store: MediaBlobStore) {
  const hydrated = await hydrateWorkspaceImages(workspace, store);
  const assets = hydrated.chats.flatMap((chat) => chat.messages.flatMap((message) => [
    ...(message.images ?? []).map((image, index) => ({
      chatId: chat.id, messageId: message.id, assetId: image.assetId ?? image.blobId ?? `${message.id}:${index}`,
      kind: "image" as const, availability: image.dataUrl?.startsWith("data:image/") ? "included" as const : "missing" as const,
      name: image.name ?? null, parentAssetId: image.parentAssetId ?? null,
    })),
    ...(message.videoUrl ? [{ chatId: chat.id, messageId: message.id, assetId: message.id, kind: "video" as const,
      availability: "external-temporary" as const, name: null, parentAssetId: null }] : []),
  ]));
  return { workspace: hydrated, assets, complete: assets.every((asset) => asset.availability === "included") };
}

export function validateCreativeParameters(input: { kind: "image" | "video"; count?: number; duration?: number }) {
  if (input.kind === "image" && (!Number.isInteger(input.count ?? 1) || (input.count ?? 1) < 1 || (input.count ?? 1) > 4)) return "Choose between 1 and 4 images.";
  if (input.kind === "video" && (!Number.isInteger(input.duration ?? 5) || (input.duration ?? 5) < 1 || (input.duration ?? 5) > 15)) return "Choose a video duration from 1 to 15 seconds.";
  return null;
}
