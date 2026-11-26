import type { Workspace } from "../types.ts";

/** Attachment bytes are bounded independently of the metadata snapshot. */
export const MAX_ATTACHMENT_DATA_CHARS = 8_000_000;
export const ACCOUNT_ATTACHMENT_ID = /^acct_[a-f0-9]{64}$/;

export type AttachmentIssue = { chatId: string; messageId: string; name: string; reason: string };

export function attachmentIssues(value: unknown): AttachmentIssue[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as Workspace).chats)) return [];
  const issues: AttachmentIssue[] = [];
  for (const chat of (value as Workspace).chats) {
    if (!chat || !Array.isArray(chat.messages)) continue;
    for (const message of chat.messages) {
      if (!message || !Array.isArray(message.images)) continue;
      for (const image of message.images) {
        if (!image || typeof image !== "object") continue;
        const name = typeof image.name === "string" ? image.name.slice(0, 120) : "Image";
        if (typeof image.dataUrl === "string" && image.dataUrl.length >= MAX_ATTACHMENT_DATA_CHARS) {
          issues.push({ chatId: chat.id, messageId: message.id, name, reason: "The image exceeds the account attachment limit. Its original bytes were kept on this device." });
        } else if (typeof image.dataUrl === "string" && !image.dataUrl.startsWith("data:image/")) {
          issues.push({ chatId: chat.id, messageId: message.id, name, reason: "The attachment is not a supported image data URL." });
        }
      }
    }
  }
  return issues;
}

/** A valid archive hash proves integrity, not the presence of referenced pixels. */
export function attachmentManifest(workspace: Workspace) {
  const images = workspace.chats.flatMap((chat) => chat.messages.flatMap((message) =>
    (message.images ?? []).map((image) => ({
      chatId: chat.id, messageId: message.id, name: image.name ?? "Image",
      ...(image.blobId ? { blobId: image.blobId } : {}),
      included: Boolean(image.dataUrl?.startsWith("data:image/")),
    }))));
  return { referenced: images.length, included: images.filter((image) => image.included).length,
    complete: images.every((image) => image.included), images };
}

/** Upload each unique image once. Never turn a failed upload into a verified reference. */
export async function prepareAccountAttachments(
  workspace: Workspace,
  upload: (dataUrl: string) => Promise<{ ok: true; id: string } | { ok: false; error: string }>,
  uploaded = new Map<string, string>(),
): Promise<{ ok: true; workspace: Workspace } | { ok: false; error: string }> {
  const issues = attachmentIssues(workspace);
  if (issues.length) return { ok: false, error: `${issues[0].name}: ${issues[0].reason}` };
  const chats: Workspace["chats"] = [];
  for (const chat of workspace.chats) {
    const messages: typeof chat.messages = [];
    for (const message of chat.messages) {
      if (!message.images?.length) { messages.push(message); continue; }
      const images = [];
      for (const image of message.images) {
        if (!image.dataUrl?.startsWith("data:image/")) { images.push(image); continue; }
        let id = uploaded.get(image.dataUrl);
        if (!id) {
          const saved = await upload(image.dataUrl);
          if (!saved.ok) return saved;
          if (!ACCOUNT_ATTACHMENT_ID.test(saved.id)) return { ok: false, error: "The attachment store returned an invalid receipt. Image bytes remain on this device." };
          id = saved.id;
          uploaded.set(image.dataUrl, id);
        }
        const { dataUrl: _dataUrl, ...metadata } = image;
        images.push({ ...metadata, blobId: id });
      }
      messages.push({ ...message, images });
    }
    chats.push({ ...chat, messages });
  }
  return { ok: true, workspace: { ...workspace, chats } };
}
