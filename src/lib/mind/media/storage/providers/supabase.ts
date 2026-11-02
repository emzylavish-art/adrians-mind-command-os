import { randomBytes } from "node:crypto";
import { resolveSupabaseStorageOrigin } from "../credentials.ts";
import { sanitizeFolderSegments, sanitizeStorageFileName } from "../safe-name.ts";
import {
  MEDIA_REMOTE_ROOT,
  SUPABASE_MAX_FILE_BYTES,
  SUPABASE_QUOTA_BYTES,
  type MediaStorageKind,
  type StorageHealth,
  type StorageProvider,
  type StorageQuota,
  type StorageUploadInput,
  type StorageUploadResult,
} from "../types.ts";

type FetchLike = typeof fetch;

type SupabaseProviderOptions = {
  /** Page size for the storage list API. Default matches the API maximum. */
  listPageSize?: number;
};

const MEDIA_BUCKETS = ["media-images", "media-video", "media-audio", "media-camera", "media-brand"] as const;
export type SupabaseMediaBucket = (typeof MEDIA_BUCKETS)[number];

const DEFAULT_LIST_PAGE = 1000;
const MAX_LIST_PREFIXES = 500;

/**
 * Supabase Storage adapter for the private media buckets on the configured project.
 * Uploads with x-upsert false (a name clash retries once under a new name).
 * Quota is the sum of object sizes across every bucket, reported against the 1 GiB plan cap.
 * Intentionally has no remove / empty-bucket methods.
 */
export function createSupabaseProvider(
  fetchImpl: FetchLike = fetch,
  env: Record<string, string | undefined> = process.env,
  options: SupabaseProviderOptions = {},
): StorageProvider {
  const pageSize = clampPageSize(options.listPageSize);
  const origin = () => resolveSupabaseStorageOrigin(env);

  return {
    service: "supabase",

    async health(accessToken: string | null): Promise<StorageHealth> {
      if (!accessToken) {
        return { ok: true, connected: false, detail: "Supabase Storage is not configured." };
      }
      const base = origin();
      if (!base) {
        return {
          ok: true,
          connected: false,
          detail: "Supabase Storage URL is missing or is not the media project.",
        };
      }
      try {
        const res = await supabaseFetch(fetchImpl, base, accessToken, "/storage/v1/bucket", { method: "GET" });
        if (res.status === 401 || res.status === 403) {
          return { ok: true, connected: false, detail: "Supabase Storage refused the service key." };
        }
        if (!res.ok) {
          return { ok: false, connected: false, detail: `Supabase Storage health check returned ${res.status}.` };
        }
        const buckets = await readBucketNames(res);
        const missing = MEDIA_BUCKETS.filter((name) => !buckets.includes(name));
        if (missing.length > 0) {
          return {
            ok: true,
            connected: true,
            detail: `Supabase Storage reachable; missing buckets: ${missing.join(", ")}.`,
          };
        }
        return { ok: true, connected: true, detail: "Supabase Storage reachable." };
      } catch {
        return { ok: false, connected: false, detail: "Supabase Storage could not be reached." };
      }
    },

    async quota(accessToken: string): Promise<StorageQuota> {
      const base = origin();
      if (!base) throw new Error("Supabase Storage URL is not configured.");
      const listed = await supabaseFetch(fetchImpl, base, accessToken, "/storage/v1/bucket", { method: "GET" });
      if (!listed.ok) throw new Error(`Supabase storage bucket list returned ${listed.status}`);
      const buckets = await readBucketNames(listed);
      let usedBytes = 0;
      for (const bucket of buckets) {
        usedBytes += await sumBucketBytes(fetchImpl, base, accessToken, bucket, pageSize);
      }
      return { usedBytes, totalBytes: SUPABASE_QUOTA_BYTES, source: "live" };
    },

    async upload(input: StorageUploadInput & { accessToken: string }): Promise<StorageUploadResult> {
      const base = origin();
      if (!base) throw new Error("Supabase Storage URL is not configured.");
      if (input.bytes.byteLength > SUPABASE_MAX_FILE_BYTES) {
        throw new Error(`Supabase Storage accepts files up to ${SUPABASE_MAX_FILE_BYTES} bytes.`);
      }
      const bucket = bucketForUpload(input);
      const fileName = sanitizeStorageFileName(input.fileName);
      const folders = [MEDIA_REMOTE_ROOT, ...sanitizeFolderSegments(input.folderSegments)];
      const objectKey = [...folders, fileName].join("/");
      const first = await putObject(fetchImpl, base, input.accessToken, bucket, objectKey, input);
      if (first.ok) return finishUpload(first.response, bucket, objectKey, input.bytes.byteLength);
      if (first.status === 409 || first.alreadyExists) {
        const retryName = uniqueFileName(fileName);
        const retryKey = [...folders, retryName].join("/");
        const second = await putObject(fetchImpl, base, input.accessToken, bucket, retryKey, input);
        if (!second.ok) throw new Error(`Supabase upload returned ${second.status}`);
        return finishUpload(second.response, bucket, retryKey, input.bytes.byteLength);
      }
      throw new Error(`Supabase upload returned ${first.status}`);
    },
  };
}

export function bucketForUpload(input: {
  mediaKind?: MediaStorageKind | string;
  mimeType?: string;
  folderSegments?: string[];
}): SupabaseMediaBucket {
  const explicit = normalizeKind(input.mediaKind);
  if (explicit && explicit !== "unknown") return bucketForKind(explicit);
  return bucketForKind(inferKind(input.mimeType, input.folderSegments));
}

function bucketForKind(kind: MediaStorageKind): SupabaseMediaBucket {
  if (kind === "camera") return "media-camera";
  if (kind === "video") return "media-video";
  if (kind === "audio") return "media-audio";
  return "media-images";
}

function inferKind(mimeType: string | undefined, folderSegments: string[] | undefined): MediaStorageKind {
  const folders = (folderSegments ?? []).map((segment) => segment.toLowerCase());
  if (folders.includes("camera")) return "camera";
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("video/") || folders.includes("video")) return "video";
  if (mime.startsWith("audio/") || folders.includes("audio")) return "audio";
  if (
    mime.startsWith("image/") ||
    folders.includes("imagine") ||
    folders.includes("image") ||
    folders.includes("images")
  ) {
    return "image";
  }
  return "unknown";
}

function normalizeKind(value: MediaStorageKind | string | undefined): MediaStorageKind | undefined {
  if (typeof value !== "string") return undefined;
  const kind = value.trim().toLowerCase();
  if (kind === "imagine" || kind === "images" || kind === "image") return "image";
  if (kind === "camera" || kind === "video" || kind === "audio" || kind === "unknown") return kind;
  return undefined;
}

function clampPageSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_LIST_PAGE;
  return Math.max(1, Math.min(DEFAULT_LIST_PAGE, Math.floor(value)));
}

function authHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    apikey: token,
    accept: "application/json",
    ...extra,
  };
}

async function supabaseFetch(
  fetchImpl: FetchLike,
  origin: string,
  token: string,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: BodyInit },
): Promise<Response> {
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password) {
    throw new Error("Supabase Storage refused a non-project URL.");
  }
  if ([...url.searchParams.values()].some((value) => value === token)) {
    throw new Error("Supabase Storage refused an unsafe URL.");
  }
  return fetchImpl(url.toString(), {
    method: init.method,
    headers: authHeaders(token, init.headers),
    body: init.body,
    redirect: "error",
  });
}

async function readBucketNames(res: Response): Promise<string[]> {
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error("Supabase storage bucket list returned an unexpected payload.");
  const names: string[] = [];
  for (const row of body) {
    if (!row || typeof row !== "object") continue;
    const name = (row as { name?: unknown; id?: unknown }).name ?? (row as { id?: unknown }).id;
    if (typeof name === "string" && name && !name.includes("..") && !name.includes("/") && !name.includes("\\")) {
      names.push(name);
    }
  }
  return names;
}

type ListedObject = {
  name?: unknown;
  id?: unknown;
  metadata?: { size?: unknown } | null;
};

async function sumBucketBytes(
  fetchImpl: FetchLike,
  origin: string,
  token: string,
  bucket: string,
  pageSize: number,
): Promise<number> {
  let used = 0;
  const pending = [""];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const prefix = pending.pop() ?? "";
    if (seen.has(prefix) || prefix.includes("..")) continue;
    seen.add(prefix);
    if (seen.size > MAX_LIST_PREFIXES) {
      throw new Error("Supabase storage list exceeded the prefix walk limit.");
    }
    let offset = 0;
    for (;;) {
      const res = await supabaseFetch(fetchImpl, origin, token, `/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prefix,
          limit: pageSize,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      });
      if (!res.ok) throw new Error(`Supabase storage list returned ${res.status}`);
      const rows = (await res.json()) as unknown;
      if (!Array.isArray(rows)) throw new Error("Supabase storage list returned an unexpected payload.");
      for (const row of rows as ListedObject[]) {
        if (!row || typeof row !== "object") continue;
        const name = typeof row.name === "string" ? row.name : "";
        const isFolder = row.id == null;
        if (isFolder) {
          if (name && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\")) {
            pending.push(prefix ? `${prefix}/${name}` : name);
          }
          continue;
        }
        const size = Number(row.metadata?.size ?? 0);
        if (Number.isFinite(size) && size > 0) used += size;
      }
      if (rows.length < pageSize) break;
      offset += rows.length;
    }
  }
  return used;
}

type PutResult =
  | { ok: true; response: Response; status: number; alreadyExists: false }
  | { ok: false; response: Response; status: number; alreadyExists: boolean };

async function putObject(
  fetchImpl: FetchLike,
  origin: string,
  token: string,
  bucket: string,
  objectKey: string,
  input: StorageUploadInput,
): Promise<PutResult> {
  const encoded = objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const res = await supabaseFetch(fetchImpl, origin, token, `/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`, {
    method: "POST",
    headers: {
      "content-type": input.mimeType || "application/octet-stream",
      "x-upsert": "false",
    },
    body: Buffer.from(input.bytes) as unknown as BodyInit,
  });
  if (res.ok) return { ok: true, response: res, status: res.status, alreadyExists: false };
  const alreadyExists = res.status === 409 || (await looksLikeAlreadyExists(res));
  return { ok: false, response: res, status: res.status, alreadyExists };
}

async function looksLikeAlreadyExists(res: Response): Promise<boolean> {
  if (res.status !== 400) return false;
  try {
    const text = await res.text();
    return /already exists|duplicate/i.test(text);
  } catch {
    return false;
  }
}

async function finishUpload(res: Response, bucket: string, objectKey: string, bytes: number): Promise<StorageUploadResult> {
  let remoteId = `${bucket}/${objectKey}`;
  try {
    const created = (await res.json()) as { Key?: string; Id?: string; id?: string };
    remoteId = created.Id || created.id || created.Key || remoteId;
  } catch {
    /* keep the object key */
  }
  return {
    remoteId,
    remotePath: `${bucket}/${objectKey}`,
    bytes,
    service: "supabase",
    accountEmail: "",
  };
}

function uniqueFileName(fileName: string): string {
  const stamp = randomBytes(3).toString("hex");
  const dot = fileName.lastIndexOf(".");
  if (dot > 0) return `${fileName.slice(0, dot)}-${stamp}${fileName.slice(dot)}`;
  return `${fileName}-${stamp}`;
}

export const SUPABASE_FORBIDDEN_OPS = ["storage object remove", "empty bucket"] as const;
