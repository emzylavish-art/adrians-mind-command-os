import { MEDIA_REMOTE_ROOT, type StorageHealth, type StorageProvider, type StorageQuota, type StorageUploadInput, type StorageUploadResult } from "../types.ts";
import { sanitizeFolderSegments, sanitizeStorageFileName } from "../safe-name.ts";

type FetchLike = typeof fetch;

function asBody(bytes: Uint8Array): BodyInit {
  return Buffer.from(bytes) as unknown as BodyInit;
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const SESSION_THRESHOLD = 4 * 1024 * 1024;

/**
 * OneDrive adapter via Microsoft Graph:
 * PUT /me/drive/root:/path:/content or createUploadSession, plus /me/drive quota.
 * Intentionally has NO delete methods.
 */
export function createOneDriveProvider(fetchImpl: FetchLike = fetch): StorageProvider {
  return {
    service: "onedrive",

    async health(accessToken: string | null): Promise<StorageHealth> {
      if (!accessToken) {
        return { ok: true, connected: false, detail: "OneDrive is not connected." };
      }
      try {
        const res = await fetchImpl(`${GRAPH}/me/drive?$select=id`, {
          headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
        });
        if (res.status === 401 || res.status === 403) {
          return { ok: true, connected: false, detail: "OneDrive refused the token. Reconnect on ServiceBoard." };
        }
        if (!res.ok) {
          return { ok: false, connected: false, detail: `OneDrive health check returned ${res.status}.` };
        }
        return { ok: true, connected: true, detail: "OneDrive reachable." };
      } catch {
        return { ok: false, connected: false, detail: "OneDrive could not be reached." };
      }
    },

    async quota(accessToken: string): Promise<StorageQuota> {
      const res = await fetchImpl(`${GRAPH}/me/drive?$select=quota`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      });
      if (!res.ok) throw new Error(`OneDrive quota returned ${res.status}`);
      const body = (await res.json()) as {
        quota?: { used?: number; total?: number };
      };
      const used = Number(body.quota?.used ?? NaN);
      const total = Number(body.quota?.total ?? NaN);
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
      const encodedPath = folders.map(encodeURIComponent).join("/") + "/" + encodeURIComponent(fileName);

      if (input.bytes.byteLength <= SESSION_THRESHOLD) {
        const res = await fetchImpl(`${GRAPH}/me/drive/root:/${encodedPath}:/content`, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${input.accessToken}`,
            "content-type": input.mimeType || "application/octet-stream",
          },
          body: asBody(input.bytes),
        });
        if (!res.ok) throw new Error(`OneDrive upload returned ${res.status}`);
        const created = (await res.json()) as { id?: string; webUrl?: string; name?: string };
        if (!created.id) throw new Error("OneDrive upload returned no id.");
        return {
          remoteId: created.id,
          remotePath: created.webUrl || remotePath,
          bytes: input.bytes.byteLength,
          service: "onedrive",
          accountEmail: "",
        };
      }

      const sessionRes = await fetchImpl(`${GRAPH}/me/drive/root:/${encodedPath}:/createUploadSession`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          item: {
            "@microsoft.graph.conflictBehavior": "rename",
            name: fileName,
          },
        }),
      });
      if (!sessionRes.ok) throw new Error(`OneDrive upload session returned ${sessionRes.status}`);
      const session = (await sessionRes.json()) as { uploadUrl?: string };
      if (!session.uploadUrl || !/^https:\/\//i.test(session.uploadUrl)) {
        throw new Error("OneDrive upload session missing https uploadUrl.");
      }
      // Only PUT to the Graph-provided uploadUrl (never a user-supplied URL — SSRF-safe).
      const total = input.bytes.byteLength;
      const chunkSize = 320 * 1024 * 10; // ~3.2 MiB (multiple of 320 KiB)
      let offset = 0;
      let last: { id?: string; webUrl?: string } | null = null;
      while (offset < total) {
        const end = Math.min(offset + chunkSize, total);
        const chunk = input.bytes.subarray(offset, end);
        const put = await fetchImpl(session.uploadUrl, {
          method: "PUT",
          headers: {
            "content-length": String(chunk.byteLength),
            "content-range": `bytes ${offset}-${end - 1}/${total}`,
          },
          body: asBody(chunk),
        });
        if (!(put.status === 202 || put.status === 201 || put.status === 200)) {
          throw new Error(`OneDrive chunk upload returned ${put.status}`);
        }
        if (put.status === 200 || put.status === 201) {
          last = (await put.json()) as { id?: string; webUrl?: string };
        }
        offset = end;
      }
      if (!last?.id) throw new Error("OneDrive upload session finished without an item id.");
      return {
        remoteId: last.id,
        remotePath: last.webUrl || remotePath,
        bytes: total,
        service: "onedrive",
        accountEmail: "",
      };
    },
  };
}

export const ONEDRIVE_FORBIDDEN_OPS = ["/drive/items/{id}", "DELETE"] as const;
