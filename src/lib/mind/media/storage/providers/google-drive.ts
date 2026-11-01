import { MEDIA_REMOTE_ROOT, type StorageHealth, type StorageProvider, type StorageQuota, type StorageUploadInput, type StorageUploadResult } from "../types.ts";
import { sanitizeFolderSegments, sanitizeStorageFileName } from "../safe-name.ts";

type FetchLike = typeof fetch;

function asBody(bytes: Uint8Array): BodyInit {
  return Buffer.from(bytes) as unknown as BodyInit;
}

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_ABOUT = "https://www.googleapis.com/drive/v3/about";

/**
 * Google Drive adapter: files.create (multipart) + about.get storageQuota.
 * Intentionally has NO delete / trash / emptyTrash methods.
 */
export function createGoogleDriveProvider(fetchImpl: FetchLike = fetch): StorageProvider {
  return {
    service: "google_drive",

    async health(accessToken: string | null): Promise<StorageHealth> {
      if (!accessToken) {
        return { ok: true, connected: false, detail: "Google Drive is not connected." };
      }
      try {
        const res = await fetchImpl(`${DRIVE_ABOUT}?fields=user`, {
          headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
        });
        if (res.status === 401 || res.status === 403) {
          return { ok: true, connected: false, detail: "Google Drive refused the token. Reconnect on ServiceBoard." };
        }
        if (!res.ok) {
          return { ok: false, connected: false, detail: `Google Drive health check returned ${res.status}.` };
        }
        return { ok: true, connected: true, detail: "Google Drive reachable." };
      } catch {
        return { ok: false, connected: false, detail: "Google Drive could not be reached." };
      }
    },

    async quota(accessToken: string): Promise<StorageQuota> {
      const res = await fetchImpl(`${DRIVE_ABOUT}?fields=storageQuota`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Google Drive quota returned ${res.status}`);
      }
      const body = (await res.json()) as {
        storageQuota?: { usage?: string; limit?: string };
      };
      const used = Number(body.storageQuota?.usage ?? NaN);
      const total = Number(body.storageQuota?.limit ?? NaN);
      if (!Number.isFinite(used)) {
        return { usedBytes: 0, totalBytes: 0, source: "unknown" };
      }
      return {
        usedBytes: used,
        totalBytes: Number.isFinite(total) ? total : 0,
        source: "live",
      };
    },

    async upload(input: StorageUploadInput & { accessToken: string }): Promise<StorageUploadResult> {
      const fileName = sanitizeStorageFileName(input.fileName);
      const folders = [MEDIA_REMOTE_ROOT, ...sanitizeFolderSegments(input.folderSegments)];
      const parentId = await ensureFolderPath(fetchImpl, input.accessToken, folders);
      const metadata = {
        name: fileName,
        parents: parentId ? [parentId] : undefined,
      };
      const boundary = `mind_boundary_${Date.now()}`;
      const metaPart = JSON.stringify(metadata);
      const preamble = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n--${boundary}\r\nContent-Type: ${input.mimeType || "application/octet-stream"}\r\n\r\n`;
      const closing = `\r\n--${boundary}--`;
      const preBytes = new TextEncoder().encode(preamble);
      const postBytes = new TextEncoder().encode(closing);
      const body = new Uint8Array(preBytes.length + input.bytes.length + postBytes.length);
      body.set(preBytes, 0);
      body.set(input.bytes, preBytes.length);
      body.set(postBytes, preBytes.length + input.bytes.length);

      const res = await fetchImpl(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,parents`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": `multipart/related; boundary=${boundary}`,
        },
        body: asBody(body),
      });
      if (!res.ok) {
        throw new Error(`Google Drive upload returned ${res.status}`);
      }
      const created = (await res.json()) as { id?: string; name?: string };
      if (!created.id) throw new Error("Google Drive upload returned no file id.");
      const remotePath = `/${folders.join("/")}/${fileName}`;
      return {
        remoteId: created.id,
        remotePath,
        bytes: input.bytes.byteLength,
        service: "google_drive",
        accountEmail: "",
      };
    },
  };
}

async function ensureFolderPath(fetchImpl: FetchLike, token: string, segments: string[]): Promise<string | null> {
  let parent: string | null = "root";
  for (const name of segments) {
    const safe = name.replace(/'/g, "\\'");
    const q = `name='${safe}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent}' in parents`;
    const listUrl = new URL(DRIVE_FILES);
    listUrl.searchParams.set("q", q);
    listUrl.searchParams.set("fields", "files(id,name)");
    listUrl.searchParams.set("pageSize", "1");
    const listed = await fetchImpl(listUrl.toString(), {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!listed.ok) throw new Error(`Google Drive folder list returned ${listed.status}`);
    const body = (await listed.json()) as { files?: { id?: string }[] };
    const existing = body.files?.[0]?.id;
    if (existing) {
      parent = existing;
      continue;
    }
    const created = await fetchImpl(DRIVE_FILES, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parent ? [parent] : undefined,
      }),
    });
    if (!created.ok) throw new Error(`Google Drive folder create returned ${created.status}`);
    const folder = (await created.json()) as { id?: string };
    if (!folder.id) throw new Error("Google Drive folder create returned no id.");
    parent = folder.id;
  }
  return parent === "root" ? null : parent;
}

/** Static assert helper for tests: adapter source must never call delete APIs. */
export const GOOGLE_DRIVE_FORBIDDEN_OPS = [
  "files.delete",
  "files.emptyTrash",
  "files.update.*trashed",
] as const;
