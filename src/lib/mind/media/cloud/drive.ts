import type { CloudFetchResult, CloudFileItem, CloudListResult } from "./types.ts";

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
  headers: { get(name: string): string | null };
}>;

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

export function isDriveImageMime(mime: string): boolean {
  return /^(image\/(png|jpeg|jpg|gif|webp))$/i.test(mime);
}

export function isDriveTextMime(mime: string, name: string): boolean {
  if (/^(text\/|application\/(json|csv|javascript|typescript))/i.test(mime)) return true;
  return /\.(txt|md|csv|json|js|ts|mjs)$/i.test(name);
}

export async function listGoogleDriveFiles(input: {
  token: string;
  pageToken?: string;
  pageSize?: number;
  query?: string;
  fetchImpl?: FetchLike;
}): Promise<CloudListResult> {
  const fetchImpl = input.fetchImpl ?? (globalThis.fetch as FetchLike);
  const url = new URL(DRIVE_FILES);
  url.searchParams.set("pageSize", String(Math.min(50, Math.max(1, input.pageSize ?? 25))));
  url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,modifiedTime,size)");
  url.searchParams.set("q", input.query?.trim() || "trashed=false");
  if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${input.token}`, accept: "application/json" },
    });
  } catch {
    return { ok: false, error: "Google Drive could not be reached. Nothing was listed." };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "Google Drive refused the token. Reconnect on ServiceBoard (MCP Integration owns OAuth).", state: "not_connected" };
  }
  if (!res.ok) {
    return { ok: false, error: `Google Drive returned ${res.status}. Nothing was listed.` };
  }
  const body = (await res.json()) as {
    nextPageToken?: string;
    files?: { id?: string; name?: string; mimeType?: string; modifiedTime?: string; size?: string }[];
  };
  const files: CloudFileItem[] = [];
  for (const row of body.files ?? []) {
    if (!row.id || !row.name) continue;
    files.push({
      id: row.id,
      name: row.name,
      mimeType: row.mimeType || "application/octet-stream",
      modifiedTime: row.modifiedTime,
      size: row.size ? Number(row.size) : undefined,
      source: "google_drive",
    });
  }
  return { ok: true, files, nextPageToken: body.nextPageToken };
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function fetchGoogleDriveFile(input: {
  token: string;
  fileId: string;
  name: string;
  mimeType: string;
  fetchImpl?: FetchLike;
  maxBytes?: number;
}): Promise<CloudFetchResult> {
  const fetchImpl = input.fetchImpl ?? (globalThis.fetch as FetchLike);
  const maxBytes = input.maxBytes ?? 1_800_000;
  const mime = input.mimeType || "application/octet-stream";

  // Native Google Docs editors need export; treat as unsupported for attach chips.
  if (mime.startsWith("application/vnd.google-apps.")) {
    return {
      ok: false,
      error: "Google Docs/Sheets/Slides export is not wired in this lane. Download as PDF/image/text first, or attach a binary file.",
    };
  }

  const url = `${DRIVE_FILES}/${encodeURIComponent(input.fileId)}?alt=media`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, { headers: { authorization: `Bearer ${input.token}` } });
  } catch {
    return { ok: false, error: "Google Drive could not be reached. Nothing was downloaded." };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "Google Drive refused the token. Reconnect on ServiceBoard." };
  }
  if (!res.ok) return { ok: false, error: `Google Drive returned ${res.status}. Nothing was downloaded.` };

  const buffer = new Uint8Array(await res.arrayBuffer());
  if (buffer.byteLength === 0) return { ok: false, error: "That Drive file was empty." };
  if (buffer.byteLength > maxBytes) {
    return { ok: false, error: `That Drive file is too large to attach (${buffer.byteLength} bytes).` };
  }

  if (isDriveImageMime(mime) || /\.(png|jpe?g|gif|webp)$/i.test(input.name)) {
    return {
      ok: true,
      name: input.name,
      mimeType: isDriveImageMime(mime) ? mime : "image/jpeg",
      base64: bytesToBase64(buffer),
      bytes: buffer.byteLength,
      kind: "image",
    };
  }

  if (isDriveTextMime(mime, input.name)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    if (text.includes("\u0000")) {
      return { ok: false, error: "That Drive file looks binary and is not a supported text or image attach." };
    }
    return {
      ok: true,
      name: input.name,
      mimeType: mime,
      base64: bytesToBase64(buffer),
      bytes: buffer.byteLength,
      kind: "text",
      text: text.slice(0, 40_000),
    };
  }

  return {
    ok: true,
    name: input.name,
    mimeType: mime,
    base64: bytesToBase64(buffer),
    bytes: buffer.byteLength,
    kind: "unsupported",
  };
}
