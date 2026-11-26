import { readDocumentOriginal, removeDocumentOriginal } from "./document-originals.ts";
import type { DocumentOriginal, LocalFileOriginal, LocalFile, LocalFileVersion, Workspace } from "./types.ts";

export const MAX_ORIGINAL_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_LIBRARY_DOCUMENTS = 1000;
export const MAX_LIBRARY_PREVIEW_CHARS = 400_000;
export const MAX_DOCUMENT_PREVIEW_CHARS = 40_000;
export type OriginalFileStore = { put(id: string, blob: Blob): Promise<void>; get(id: string): Promise<Blob | undefined>; remove(id: string): Promise<void>; clear(): Promise<void> };

export function originalFileDatabase(ownerId: string): string {
  if (!ownerId) throw new Error("Sign in before saving an original file.");
  return `amcos.documents.v1.owner.${encodeURIComponent(ownerId)}`;
}

export function accountOriginalFileStore(ownerId: string): OriginalFileStore {
  const name = originalFileDatabase(ownerId);
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("Original-file storage is unavailable in this browser."));
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("originals")) request.result.createObjectStore("originals"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Original-file storage could not be opened."));
  });
  const write = async (operation: (store: IDBObjectStore) => void) => {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("originals", "readwrite");
        operation(transaction.objectStore("originals"));
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(new Error("The original file was not saved. Browser storage may be full or unavailable."));
      });
    } finally { db.close(); }
  };
  return {
    put: (id, blob) => write((store) => { store.put(blob, id); }),
    remove: (id) => write((store) => { store.delete(id); }),
    clear: () => write((store) => { store.clear(); }),
    async get(id) {
      const db = await open();
      try {
        return await new Promise<Blob | undefined>((resolve, reject) => {
          const request = db.transaction("originals", "readonly").objectStore("originals").get(id);
          request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined);
          request.onerror = () => reject(new Error("The original file could not be read on this device."));
        });
      } finally { db.close(); }
    },
  };
}

export async function fileChecksum(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareLibraryDocument(file: File, input: {
  projectId: string | null;
  store: OriginalFileStore;
  extractPdf?: (bytes: Uint8Array) => Promise<{ ok: boolean; text?: string; partial?: boolean; coverage?: string; error?: string }>;
  isCurrent?: () => boolean;
  sourceChatId?: string;
  sourceMessageId?: string;
}): Promise<LocalFile & { original: LocalFileOriginal }> {
  if (file.size > MAX_ORIGINAL_FILE_BYTES) throw new Error("Original files are limited to 20 MB on this device. Nothing was saved.");
  const bytes = await file.arrayBuffer();
  if (input.isCurrent && !input.isCurrent()) throw new Error("The account or destination changed. This upload was not added.");
  const hash = await fileChecksum(bytes);
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  const isText = /\.(?:txt|md|markdown|csv|json|[cm]?[jt]sx?|py|css|html?|xml|ya?ml|toml|log|sql|sh|rs|go|java|c|cpp|h)$/i.test(file.name) || file.type.startsWith("text/");
  let text = "";
  let partial = false;
  let extraction = "No text extraction is available for this format. The original is preserved.";
  if (isPdf && input.extractPdf) {
    const result = await input.extractPdf(new Uint8Array(bytes));
    if (result.ok) { text = result.text ?? ""; partial = !!result.partial; extraction = result.coverage || "PDF text extracted; visuals remain in the original."; }
    else extraction = result.error || "PDF text extraction was unavailable. The original is preserved.";
  } else if (isText) {
    text = new TextDecoder().decode(bytes);
    if (text.includes("\u0000")) { text = ""; extraction = "Binary content was not decoded as text. The original is preserved."; }
    else extraction = "UTF-8 text preview. The original is preserved independently.";
  }
  partial ||= text.length > MAX_DOCUMENT_PREVIEW_CHARS;
  text = text.slice(0, MAX_DOCUMENT_PREVIEW_CHARS);
  if (input.isCurrent && !input.isCurrent()) throw new Error("The account or destination changed. This upload was not added.");
  const blobId = `document_${hash}`;
  await input.store.put(blobId, new Blob([bytes], { type: file.type || "application/octet-stream" }));
  if (input.isCurrent && !input.isCurrent()) throw new Error("The destination changed after saving the original on its originating account. No workspace entry was added.");
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), versionId: crypto.randomUUID(), name: file.name, text, bytes: file.size, projectId: input.projectId, createdAt: now, updatedAt: now, partial,
    original: { blobId, sha256: hash, bytes: file.size, mime: file.type || "application/octet-stream", name: file.name }, extraction,
    ...(input.sourceChatId ? { sourceChatId: input.sourceChatId } : {}), ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}) };
}

export async function readAccountOriginal(file: Pick<LocalFile, "original">, owner: string): Promise<Blob> {
  const original = file.original;
  if (original && "id" in original) {
    const blob = await readDocumentOriginal(owner, original.id, original.sha256);
    if (!blob || blob.size !== original.bytes) throw new Error("The verified original is unavailable on this device.");
    return blob;
  }
  return readVerifiedOriginal(file, accountOriginalFileStore(owner));
}

export function originalKey(original: DocumentOriginal): string {
  return "id" in original ? "browser:" + original.id : "library:" + original.blobId;
}

export function removeAccountOriginal(owner: string, original: DocumentOriginal): Promise<void> {
  return "id" in original ? removeDocumentOriginal(owner, original.id) : accountOriginalFileStore(owner).remove(original.blobId);
}

export async function readVerifiedOriginal(file: Pick<LocalFile, "original">, store: OriginalFileStore): Promise<Blob> {
  if (!file.original) throw new Error("This legacy entry contains extracted text only; its original was not saved.");
  if (!("blobId" in file.original)) throw new Error("This original requires the originating account document store.");
  const blob = await store.get(file.original.blobId);
  if (!blob) throw new Error("The original is not available on this device. The saved text preview is still available.");
  if (blob.size !== file.original.bytes || await fileChecksum(await blob.arrayBuffer()) !== file.original.sha256) throw new Error("The original-file integrity check failed. Download was stopped.");
  return blob;
}

export function libraryPreviewCharacters(files: LocalFile[]): number {
  return files.reduce((sum, file) => sum + file.text.length + (file.versions ?? []).reduce((total, version) => total + version.text.length, 0), 0);
}

export function saveLibraryDocument(ws: Workspace, document: LocalFile): { ok: true; workspace: Workspace } | { ok: false; error: string } {
  if (ws.files.length >= MAX_LIBRARY_DOCUMENTS) return { ok: false, error: "The document catalog is full. Export and remove entries before adding more; no existing file was removed." };
  if (libraryPreviewCharacters([...ws.files, document]) > MAX_LIBRARY_PREVIEW_CHARS) return { ok: false, error: "Text preview storage is full. The original remains on this device; remove unused previews before adding this entry." };
  return { ok: true, workspace: { ...ws, files: [document, ...ws.files] } };
}

function asVersion(file: LocalFile): LocalFileVersion {
  return { versionId: file.versionId || file.id, name: file.name, text: file.text, bytes: file.bytes, original: file.original, partial: file.partial, extraction: file.extraction, at: file.updatedAt || file.createdAt };
}

export function replaceLibraryDocument(previous: LocalFile, next: LocalFile): LocalFile {
  const versions = [...(previous.versions ?? []), asVersion(previous)];
  return { ...next, id: previous.id, createdAt: previous.createdAt, projectId: previous.projectId, versions };
}

export function restoreLibraryVersion(file: LocalFile, versionId: string): LocalFile | null {
  const version = file.versions?.find((row) => row.versionId === versionId);
  if (!version) return null;
  const now = new Date().toISOString();
  return replaceLibraryDocument(file, { ...file, ...version, versionId: crypto.randomUUID(), updatedAt: now });
}

/** Compare-and-set prevents a late upload from replacing a version selected meanwhile. */
export function updateLibraryDocument(ws: Workspace, document: LocalFile, expectedVersion: string): { ok: true; workspace: Workspace } | { ok: false; error: string } {
  const current = ws.files.find((file) => file.id === document.id);
  if (!current || (current.versionId || current.id) !== expectedVersion) return { ok: false, error: "This document changed while the action was pending. Both versions were kept; reopen it before applying the change." };
  const files = ws.files.map((file) => file.id === document.id ? document : file);
  if (libraryPreviewCharacters(files) > MAX_LIBRARY_PREVIEW_CHARS) return { ok: false, error: "Text preview storage is full. No previous version was removed." };
  return { ok: true, workspace: { ...ws, files } };
}

export function parseCsvPreview(text: string, maxRows = 100, maxColumns = 20) {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false; let truncated = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === "," || c === "\n" || c === undefined)) {
      if (row.length < maxColumns) row.push(cell); else truncated = true;
      cell = "";
      if (c !== ",") { if (row.some(Boolean)) rows.push(row); row = []; if (rows.length >= maxRows && i < text.length - 1) { truncated = true; break; } }
    } else if (c !== "\r" && c !== undefined) cell += c;
  }
  return { rows, truncated, malformed: quoted };
}
