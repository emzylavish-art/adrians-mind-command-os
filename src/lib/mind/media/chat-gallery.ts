/**
 * Per-chat media gallery helpers — read message image refs only (no new storage).
 */

export type ChatGalleryKind = "attached" | "camera" | "generated" | "edited";

export type ChatGalleryItem = {
  key: string;
  src: string;
  name: string;
  messageId: string;
  kind: ChatGalleryKind;
};

export type GalleryMessage = {
  id: string;
  role?: string;
  images?: { dataUrl?: string; blobId?: string; name?: string | null; origin?: ChatGalleryKind }[];
};

export function imageDownloadName(dataUrl: string, name: string) {
  const mime = dataUrl.slice(5, dataUrl.indexOf(";")).toLowerCase();
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" } as Record<string, string>)[mime];
  if (!extension) return null;
  const base = (name || "image").replace(/\.(?:jpe?g|png|gif|webp)$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  return (base || "image") + "." + extension;
}

/**
 * List displayable images for one chat from existing message refs.
 * Only includes hydrated data: URLs (data:image/…); blobId-only placeholders are skipped
 * until hydrate fills dataUrl.
 */
export function listChatGalleryImages(messages: GalleryMessage[] | undefined | null): ChatGalleryItem[] {
  if (!messages?.length) return [];
  const out: ChatGalleryItem[] = [];
  for (const msg of messages) {
    if (!msg?.images?.length) continue;
    msg.images.forEach((image, index) => {
      const src = typeof image.dataUrl === "string" ? image.dataUrl : "";
      if (!src.startsWith("data:image/")) return;
      const name = (image.name && String(image.name).trim()) || `image-${index + 1}`;
      out.push({
        key: `${msg.id}:${index}:${image.blobId ?? name}`,
        src,
        name,
        messageId: msg.id,
        kind: image.origin ?? (msg.role === "assistant" ? "generated" : "attached"),
      });
    });
  }
  return out;
}
