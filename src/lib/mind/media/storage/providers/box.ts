import {
  MEDIA_REMOTE_ROOT,
  type StorageHealth,
  type StorageProvider,
  type StorageQuota,
  type StorageUploadInput,
  type StorageUploadResult,
} from "../types.ts";
import { sanitizeFolderSegments, sanitizeStorageFileName } from "../safe-name.ts";

type FetchLike = typeof fetch;

function asBody(bytes: Uint8Array): BodyInit {
  return Buffer.from(bytes) as unknown as BodyInit;
}

const BOX_API = "https://api.box.com/2.0";
const BOX_UPLOAD = "https://upload.box.com/api/2.0/files/content";
const BOX_FETCH_TIMEOUT_MS = 30_000;

function redactToken(text: string, token: string): string {
  if (!token) return text;
  return text.split(token).join("[redacted]");
}

function safeBoxError(status: number, token: string): string {
  return redactToken(`Box request failed (HTTP ${status})`, token);
}

async function boxFetch(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit & { accessToken: string },
): Promise<Response> {
  const { accessToken, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BOX_FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      ...rest,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        ...(rest.headers || {}),
        authorization: `Bearer ${accessToken}`,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

type BoxFolder = { id?: string; type?: string; name?: string };
type BoxUploadBody = {
  entries?: Array<{ id?: string; name?: string; path_collection?: unknown }>;
  id?: string;
  name?: string;
};
type BoxUser = {
  login?: string;
  space_used?: number;
  space_amount?: number;
};

async function ensureFolder(
  fetchImpl: FetchLike,
  accessToken: string,
  parentId: string,
  name: string,
): Promise<string> {
  const res = await boxFetch(fetchImpl, `${BOX_API}/folders`, {
    method: "POST",
    accessToken,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ name, parent: { id: parentId } }),
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(safeBoxError(res.status, accessToken));
  }
  if (res.status === 201 || res.status === 200) {
    const body = (await res.json()) as BoxFolder;
    if (!body.id) throw new Error("Box folder create returned no id.");
    return body.id;
  }
  if (res.status === 409) {
    // Name conflict — extract existing folder id from context_info.conflicts
    let body: {
      context_info?: { conflicts?: Array<{ id?: string; type?: string; name?: string }> };
    } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      body = {};
    }
    const conflict = (body.context_info?.conflicts || []).find(
      (c) => c && (c.type === "folder" || !c.type) && typeof c.id === "string",
    );
    if (conflict?.id) return conflict.id;

    // Fallback: list parent items and match by name
    const list = await boxFetch(
      fetchImpl,
      `${BOX_API}/folders/${encodeURIComponent(parentId)}/items?fields=id,name,type&limit=1000`,
      { method: "GET", accessToken, headers: { accept: "application/json" } },
    );
    if (!list.ok) throw new Error(safeBoxError(list.status, accessToken));
    const listed = (await list.json()) as { entries?: BoxFolder[] };
    const hit = (listed.entries || []).find((e) => e.type === "folder" && e.name === name && e.id);
    if (hit?.id) return hit.id;
    throw new Error(safeBoxError(409, accessToken));
  }
  throw new Error(safeBoxError(res.status, accessToken));
}

/**
 * Box adapter: multipart upload to upload.box.com + users/me for health/quota.
 * Refresh tokens rotate on every refresh (handled in storage-token-refresh).
 * Intentionally has NO delete methods.
 */
export function createBoxProvider(fetchImpl: FetchLike = fetch): StorageProvider {
  return {
    service: "box",

    async health(accessToken: string | null): Promise<StorageHealth> {
      if (!accessToken) {
        return { ok: true, connected: false, detail: "Box is not connected." };
      }
      try {
        const res = await boxFetch(fetchImpl, `${BOX_API}/users/me?fields=login`, {
          method: "GET",
          accessToken,
          headers: { accept: "application/json" },
        });
        if (res.status === 401 || res.status === 403) {
          return { ok: true, connected: false, detail: "Box refused the token. Reconnect the account." };
        }
        if (res.status >= 300 && res.status < 400) {
          return { ok: false, connected: false, detail: "Box health check was redirected." };
        }
        if (!res.ok) {
          return { ok: false, connected: false, detail: `Box health check returned ${res.status}.` };
        }
        return { ok: true, connected: true, detail: "Box reachable." };
      } catch {
        return { ok: false, connected: false, detail: "Box could not be reached." };
      }
    },

    async quota(accessToken: string): Promise<StorageQuota> {
      const res = await boxFetch(fetchImpl, `${BOX_API}/users/me?fields=space_used,space_amount`, {
        method: "GET",
        accessToken,
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(safeBoxError(res.status, accessToken));
      const body = (await res.json()) as BoxUser;
      const used = Number(body.space_used ?? NaN);
      const total = Number(body.space_amount ?? NaN);
      if (!Number.isFinite(used)) return { usedBytes: 0, totalBytes: 0, source: "unknown" };
      return {
        usedBytes: used,
        totalBytes: Number.isFinite(total) ? total : 0,
        source: "live",
      };
    },

    async upload(input: StorageUploadInput & { accessToken: string }): Promise<StorageUploadResult> {
      const fileName = sanitizeStorageFileName(input.fileName);
      const folders = [MEDIA_REMOTE_ROOT, ...sanitizeFolderSegments(input.folderSegments)];
      const remotePath = `/${folders.join("/")}/${fileName}`;

      let parentId = "0";
      for (const segment of folders) {
        parentId = await ensureFolder(fetchImpl, input.accessToken, parentId, segment);
      }

      const form = new FormData();
      form.append(
        "attributes",
        JSON.stringify({
          name: fileName,
          parent: { id: parentId },
        }),
      );
      const blob = new Blob([Buffer.from(input.bytes)], {
        type: input.mimeType || "application/octet-stream",
      });
      form.append("file", blob, fileName);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), BOX_FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetchImpl(BOX_UPLOAD, {
          method: "POST",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${input.accessToken}`,
            // Let fetch set multipart boundary; do not set content-type manually.
          },
          body: form,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status >= 300 && res.status < 400) {
        throw new Error(safeBoxError(res.status, input.accessToken));
      }
      if (!res.ok) {
        throw new Error(safeBoxError(res.status, input.accessToken));
      }

      let body: BoxUploadBody = {};
      try {
        body = (await res.json()) as BoxUploadBody;
      } catch {
        body = {};
      }
      const entry = Array.isArray(body.entries) ? body.entries[0] : undefined;
      const fileId = (entry && entry.id) || body.id;
      if (!fileId) {
        throw new Error("Box upload returned no file id.");
      }

      return {
        remoteId: String(fileId),
        remotePath,
        bytes: input.bytes.byteLength,
        service: "box",
        accountEmail: "",
      };
    },
  };
}

export const BOX_FORBIDDEN_OPS = ["files/delete", "DELETE /files", "trash"] as const;
