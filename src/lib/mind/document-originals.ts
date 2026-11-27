import type { BrowserDocumentOriginal } from "./types.ts";
import { MAX_DOCUMENT_INPUT_BYTES } from "./knowledge.ts";

type Record = { ownerId: string; id: string; name: string; mime: string; data: Blob; sha256: string };
const databaseName = (ownerId: string) => `amcos.document-originals.v1.owner.${encodeURIComponent(ownerId)}`;

async function database(ownerId: string): Promise<IDBDatabase> {
  if (!ownerId) throw new Error("Sign in before keeping an original document.");
  if (typeof indexedDB === "undefined") throw new Error("Original-file storage is unavailable in this browser.");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName(ownerId), 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("originals", { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Original-file storage could not be opened."));
  });
}

export async function saveDocumentOriginal(ownerId: string, file: File, id: string = crypto.randomUUID()): Promise<BrowserDocumentOriginal> {
  if (file.size > MAX_DOCUMENT_INPUT_BYTES) throw new Error("Original documents are limited to 5 MB per file.");
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  const db = await database(ownerId);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("originals", "readwrite");
      tx.objectStore("originals").put({ ownerId, id, name: file.name, mime: file.type || "application/octet-stream", data: new Blob([bytes], { type: file.type }), sha256 } satisfies Record);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("The original document could not be stored."));
    });
    return { id, sha256, bytes: file.size, mime: file.type || "application/octet-stream", storage: "browser" };
  } finally { db.close(); }
}

export async function readDocumentOriginal(ownerId: string, id: string, expectedSha256?: string): Promise<Blob | null> {
  const db = await database(ownerId);
  try {
    const saved = await new Promise<Record | null>((resolve, reject) => {
      const request = db.transaction("originals", "readonly").objectStore("originals").get(id);
      request.onsuccess = () => { const record = request.result as Record | undefined; resolve(record?.ownerId === ownerId ? record : null); };
      request.onerror = () => reject(request.error);
    });
    if (!saved) return null;
    const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await saved.data.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== saved.sha256 || (expectedSha256 !== undefined && actual !== expectedSha256)) throw new Error("Original document checksum mismatch. These bytes cannot be attributed to the saved revision.");
    return saved.data;
  } finally { db.close(); }
}

export async function removeDocumentOriginal(ownerId: string, id: string): Promise<void> {
  const db = await database(ownerId);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("originals", "readwrite");
      tx.objectStore("originals").delete(id);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
