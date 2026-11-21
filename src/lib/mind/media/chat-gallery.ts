/**
 * Per-chat media gallery helpers — read message image refs only (no new storage).
 */

export type ChatGalleryKind = "attached" | "camera" | "generated";

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
  images?: { dataUrl?: string; blobId?: string; name?: string | null }[];
};

export function classifyGalleryName(name: string | null | undefined, role?: string): ChatGalleryKind {
  const label = (name ?? "").toLowerCase();
  if (/^camera/.test(label) || /burst|capture/.test(label)) return "camera";
  if (/^generated|^imagine|grok-imagine|edited/.test(label)) return "generated";
  if (role === "assistant" && (!name || /image|attachment|amcos/.test(label))) return "generated";
  return "attached";
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
        kind: classifyGalleryName(name, msg.role),
      });
    });
  }
  return out;
}
