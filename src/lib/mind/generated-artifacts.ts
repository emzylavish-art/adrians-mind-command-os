import type { Chat, LocalFile, Msg, MsgImage, Workspace } from "./types.ts";
import { prepareLibraryDocument, replaceLibraryDocument, saveLibraryDocument, updateLibraryDocument, type OriginalFileStore } from "./library-documents.ts";

type ArtifactOrigin = { id: string; chatId: string; chatTitle: string; messageId: string; projectId: string | null; at: string; provider?: string; model?: string; temporary: boolean; name: string; replyVersionId?: string; selectedReplyVersionId?: string };
export type GeneratedArtifact = ArtifactOrigin & (
  | { kind: "image"; image: MsgImage; imageIndex: number }
  | { kind: "video"; url: string }
  | { kind: "code"; language: string; text: string; sourceRange: { start: number; end: number } }
  | { kind: "document"; text: string }
);
export type ArtifactImageSource = { ownerId: string; chatId: string; messageId: string; imageIndex: number; dataUrl: string; blobId?: string; name: string };

const extension: Record<string, string> = { ts: "ts", typescript: "ts", tsx: "tsx", js: "js", javascript: "js", jsx: "jsx", python: "py", py: "py", json: "json", jsonc: "json", html: "html", css: "css", sql: "sql", bash: "sh", shell: "sh", sh: "sh", yaml: "yaml", yml: "yaml", markdown: "md", md: "md", rust: "rs", go: "go", java: "java", cpp: "cpp", c: "c", text: "txt", txt: "txt" };

/** Only completed fences become code artifacts. An interrupted user.partialReply is never inspected. */
export function completedCodeArtifacts(text: string) {
  return [...text.matchAll(/^```([^\n`]*)\r?\n([\s\S]*?)^```[ \t]*$/gm)].map((match, index) => {
    const language = match[1].trim().split(/\s+/)[0].toLowerCase();
    const start = match.index! + match[0].indexOf("\n") + 1;
    const content = match[2];
    return { index, language: language || "text", extension: extension[language] ?? "txt", text: content, sourceRange: { start, end: start + content.length } };
  });
}

function artifactsForMessage(chat: Chat, message: Msg, replyVersionId?: string): GeneratedArtifact[] {
  if (message.kind === "error") return [];
  const suffix = replyVersionId ? `:version:${replyVersionId}` : "";
  const origin = { chatId: chat.id, chatTitle: chat.title, messageId: message.id, projectId: chat.projectId, temporary: chat.temporary, at: message.at, provider: message.provider, model: message.model, ...(replyVersionId ? { replyVersionId } : { selectedReplyVersionId: message.selectedReplyVersionId }) };
  const artifacts: GeneratedArtifact[] = [];
  for (const [imageIndex, image] of (message.images ?? []).entries()) {
    if (!image.blobId && !image.dataUrl?.startsWith("data:image/")) continue;
    artifacts.push({ ...origin, id: `artifact:${chat.id}:${message.id}${suffix}:image:${imageIndex}`, kind: "image", name: image.name || `Image ${imageIndex + 1}`, image, imageIndex });
  }
  // The Library's image inventory also includes real user attachments/camera
  // assets, but user text and interrupted response fragments are not generated documents.
  if (message.role !== "assistant") return artifacts;
  if (message.videoUrl && /^https:\/\//i.test(message.videoUrl)) artifacts.push({ ...origin, id: `artifact:${chat.id}:${message.id}${suffix}:video`, kind: "video", name: "Generated video", url: message.videoUrl });
  for (const code of completedCodeArtifacts(message.content)) artifacts.push({ ...origin, id: `artifact:${chat.id}:${message.id}${suffix}:code:${code.index}`, kind: "code", name: `code-${code.index + 1}.${code.extension}`, language: code.language, text: code.text, sourceRange: code.sourceRange });
  if (message.content.trim()) artifacts.push({ ...origin, id: `artifact:${chat.id}:${message.id}${suffix}:document`, kind: "document", name: `reply-${message.id.slice(0, 12)}.md`, text: message.content });
  return artifacts;
}

/** References existing stored replies. Listing does not copy blobs, run code, fetch providers, or finalize streams. */
export function listGeneratedArtifacts(workspace: Workspace, filter: { kind?: GeneratedArtifact["kind"] | "all"; projectId?: string | null; query?: string; includeTemporary?: boolean } = {}) {
  const result: GeneratedArtifact[] = [];
  for (const chat of workspace.chats) {
    if (chat.temporary && !filter.includeTemporary) continue;
    if (filter.projectId !== undefined && chat.projectId !== filter.projectId) continue;
    for (const message of chat.messages) {
      result.push(...artifactsForMessage(chat, message));
      for (const version of message.replyVersions ?? []) {
        if (version.id === message.selectedReplyVersionId) continue;
        result.push(...artifactsForMessage(chat, { ...message, ...version, id: message.id, images: version.images, videoUrl: version.videoUrl, provider: version.provider, model: version.model, replyVersions: undefined, selectedReplyVersionId: undefined }, version.id));
      }
    }
  }
  const query = filter.query?.trim().toLowerCase();
  return result.filter((artifact) => (!filter.kind || filter.kind === "all" || artifact.kind === filter.kind) && (!query || `${artifact.name} ${artifact.chatTitle} ${artifact.model ?? ""}`.toLowerCase().includes(query))).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export function artifactSourceIsCurrent(workspace: Workspace, artifact: GeneratedArtifact): boolean {
  const current = listGeneratedArtifacts(workspace, { kind: artifact.kind, includeTemporary: true }).find((entry) => entry.id === artifact.id);
  if (!current || current.projectId !== artifact.projectId || current.temporary !== artifact.temporary || current.at !== artifact.at || current.name !== artifact.name || current.provider !== artifact.provider || current.model !== artifact.model || current.replyVersionId !== artifact.replyVersionId || current.selectedReplyVersionId !== artifact.selectedReplyVersionId) return false;
  if ((artifact.kind === "code" || artifact.kind === "document") && (current.kind === "code" || current.kind === "document")) return current.text === artifact.text;
  if (artifact.kind === "image" && current.kind === "image") return current.image.blobId === artifact.image.blobId && current.image.dataUrl === artifact.image.dataUrl;
  return artifact.kind === "video" && current.kind === "video" && current.url === artifact.url;
}

/** A cached preview is also revalidated synchronously before an edit/download action. */
export function artifactImageCanBeUsed(workspace: Workspace, artifact: GeneratedArtifact, image: ArtifactImageSource, ownerId: string): boolean {
  return artifact.kind === "image" && image.ownerId === ownerId && image.chatId === artifact.chatId && image.messageId === artifact.messageId && image.imageIndex === artifact.imageIndex && image.blobId === artifact.image.blobId && image.name === artifact.name && (!artifact.image.dataUrl || image.dataUrl === artifact.image.dataUrl) && artifactSourceIsCurrent(workspace, artifact);
}

export async function resolveArtifactImage(artifact: GeneratedArtifact, input: { ownerId: string; currentOwner: () => string; currentWorkspace: () => Workspace; getOwned: (id: string) => Promise<unknown> }): Promise<ArtifactImageSource> {
  if (artifact.kind !== "image") throw new Error("Select an image artifact.");
  if (!input.ownerId || input.currentOwner() !== input.ownerId) throw new Error("The account changed. The image was not opened.");
  if (!artifactSourceIsCurrent(input.currentWorkspace(), artifact)) throw new Error("The source image changed. Select the current image again.");
  let dataUrl = artifact.image.dataUrl;
  if (!dataUrl && artifact.image.blobId) {
    const stored = await input.getOwned(artifact.image.blobId);
    dataUrl = typeof stored === "string" ? stored : stored && typeof stored === "object" && "dataUrl" in stored && typeof stored.dataUrl === "string" ? stored.dataUrl : undefined;
  }
  if (input.currentOwner() !== input.ownerId) throw new Error("The account changed. The image was not opened.");
  if (!artifactSourceIsCurrent(input.currentWorkspace(), artifact)) throw new Error("The source image changed. Select the current image again.");
  if (!dataUrl || !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(dataUrl)) throw new Error("This image's bytes are unavailable for this account on this device.");
  return { ownerId: input.ownerId, chatId: artifact.chatId, messageId: artifact.messageId, imageIndex: artifact.imageIndex, dataUrl, blobId: artifact.image.blobId, name: artifact.name };
}

export async function prepareArtifactDocument(artifact: GeneratedArtifact, input: { ownerId: string; currentOwner: () => string; store: OriginalFileStore; isCurrent?: () => boolean }): Promise<LocalFile> {
  if (artifact.kind !== "code" && artifact.kind !== "document") throw new Error("Save an image or video using its original media action.");
  if (!input.ownerId || input.currentOwner() !== input.ownerId) throw new Error("The account changed. The artifact was not saved.");
  const document = await prepareLibraryDocument(new File([artifact.text], artifact.name, { type: artifact.kind === "document" ? "text/markdown" : "text/plain" }), { projectId: artifact.projectId, store: input.store, sourceChatId: artifact.chatId, sourceMessageId: artifact.messageId, isCurrent: () => input.currentOwner() === input.ownerId && (input.isCurrent?.() ?? true) });
  return { ...document, id: artifact.id };
}

/** Re-saving the same source bytes is idempotent; changed bytes become a retained Library version. */
export function saveGeneratedArtifact(workspace: Workspace, document: LocalFile): { ok: true; workspace: Workspace; unchanged: boolean } | { ok: false; error: string } {
  const existing = workspace.files.find((file) => file.id === document.id);
  if (!existing) { const result = saveLibraryDocument(workspace, document); return result.ok ? { ...result, unchanged: false } : result; }
  if (existing.original?.sha256 && existing.original.sha256 === document.original?.sha256) return { ok: true, workspace, unchanged: true };
  const result = updateLibraryDocument(workspace, replaceLibraryDocument(existing, document), existing.versionId || existing.id);
  return result.ok ? { ...result, unchanged: false } : result;
}
