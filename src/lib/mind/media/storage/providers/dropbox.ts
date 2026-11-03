import { MEDIA_REMOTE_ROOT, type StorageHealth, type StorageProvider, type StorageQuota, type StorageUploadInput, type StorageUploadResult } from "../types.ts";
import { sanitizeFolderSegments, sanitizeStorageFileName } from "../safe-name.ts";

type FetchLike = typeof fetch;

function asBody(bytes: Uint8Array): BodyInit {
  return Buffer.from(bytes) as unknown as BodyInit;
}

const DROPBOX_UPLOAD = "https://content.dropboxapi.com/2/files/upload";
const DROPBOX_UPLOAD_SESSION_START = "https://content.dropboxapi.com/2/files/upload_session/start";
const DROPBOX_UPLOAD_SESSION_APPEND = "https://content.dropboxapi.com/2/files/upload_session/append_v2";
const DROPBOX_UPLOAD_SESSION_FINISH = "https://content.dropboxapi.com/2/files/upload_session/finish";
const DROPBOX_SPACE = "https://api.dropboxapi.com/2/users/get_space_usage";
/** files.list_folder works with files.* scopes; users.get_current_account needs account_info.read. */
const DROPBOX_LIST_FOLDER = "https://api.dropboxapi.com/2/files/list_folder";
const SESSION_THRESHOLD = 8 * 1024 * 1024; // use sessions above 8 MiB
const SESSION_CHUNK = 4 * 1024 * 1024;

/**
 * Dropbox adapter: files/upload (+ upload sessions for large files) and users/get_space_usage.
 * Intentionally has NO delete / permanently_delete methods.
 */
export function createDropboxProvider(fetchImpl: FetchLike = fetch): StorageProvider {
  return {
    service: "dropbox",

    async health(accessToken: string | null): Promise<StorageHealth> {
      if (!accessToken) {
        return { ok: true, connected: false, detail: "Dropbox is not connected." };
      }
      try {
        // Prefer files.list_folder so tokens granted with files.* scopes (without account_info.read) still verify.
        const res = await fetchImpl(DROPBOX_LIST_FOLDER, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ path: "", limit: 1 }),
        });
        if (res.status === 401 || res.status === 403) {
          let detail = "Dropbox refused the token. Reconnect on ServiceBoard.";
          try {
            const body = (await res.json()) as { error_summary?: string; error?: { ".tag"?: string; required_scope?: string } };
            const tag = body.error?.[".tag"] || body.error_summary || "";
            if (String(tag).includes("missing_scope")) {
              const required = body.error?.required_scope ? ` (needs ${body.error.required_scope})` : "";
              detail = `Dropbox token is missing required scope${required}. Re-consent with files.content.read (and account_info.read for quota).`;
            }
          } catch {
            /* keep default detail */
          }
          return { ok: true, connected: false, detail };
        }
        if (!res.ok) {
          return { ok: false, connected: false, detail: `Dropbox health check returned ${res.status}.` };
        }
        return { ok: true, connected: true, detail: "Dropbox reachable." };
      } catch {
        return { ok: false, connected: false, detail: "Dropbox could not be reached." };
      }
    },

    async quota(accessToken: string): Promise<StorageQuota> {
      const res = await fetchImpl(DROPBOX_SPACE, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Dropbox quota returned ${res.status}`);
      const body = (await res.json()) as {
        used?: number;
        allocation?: { allocated?: number; ".tag"?: string };
      };
      const used = Number(body.used ?? NaN);
      const total = Number(body.allocation?.allocated ?? NaN);
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
      const arg = {
        path: remotePath,
        mode: { ".tag": "add" as const },
        autorename: true,
        mute: true,
      };

      if (input.bytes.byteLength <= SESSION_THRESHOLD) {
        const res = await fetchImpl(DROPBOX_UPLOAD, {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.accessToken}`,
            "content-type": "application/octet-stream",
            "dropbox-api-arg": JSON.stringify(arg),
          },
          body: asBody(input.bytes),
        });
        if (!res.ok) throw new Error(`Dropbox upload returned ${res.status}`);
        const created = (await res.json()) as { id?: string; path_display?: string };
        return {
          remoteId: created.id || remotePath,
          remotePath: created.path_display || remotePath,
          bytes: input.bytes.byteLength,
          service: "dropbox",
          accountEmail: "",
        };
      }

      // Large file: upload session
      const start = await fetchImpl(DROPBOX_UPLOAD_SESSION_START, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/octet-stream",
          "dropbox-api-arg": JSON.stringify({ close: false }),
        },
        body: asBody(input.bytes.subarray(0, Math.min(SESSION_CHUNK, input.bytes.byteLength))),
      });
      if (!start.ok) throw new Error(`Dropbox upload session start returned ${start.status}`);
      const session = (await start.json()) as { session_id?: string };
      if (!session.session_id) throw new Error("Dropbox upload session missing id.");
      let offset = Math.min(SESSION_CHUNK, input.bytes.byteLength);
      while (offset < input.bytes.byteLength) {
        const end = Math.min(offset + SESSION_CHUNK, input.bytes.byteLength);
        const chunk = input.bytes.subarray(offset, end);
        const isLast = end >= input.bytes.byteLength;
        if (isLast) break;
        const append = await fetchImpl(DROPBOX_UPLOAD_SESSION_APPEND, {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.accessToken}`,
            "content-type": "application/octet-stream",
            "dropbox-api-arg": JSON.stringify({
              cursor: { session_id: session.session_id, offset },
              close: false,
            }),
          },
          body: asBody(chunk),
        });
        if (!append.ok) throw new Error(`Dropbox upload session append returned ${append.status}`);
        offset = end;
      }
      const finishBody = input.bytes.subarray(offset);
      const finish = await fetchImpl(DROPBOX_UPLOAD_SESSION_FINISH, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/octet-stream",
          "dropbox-api-arg": JSON.stringify({
            cursor: { session_id: session.session_id, offset },
            commit: arg,
          }),
        },
        body: asBody(finishBody),
      });
      if (!finish.ok) throw new Error(`Dropbox upload session finish returned ${finish.status}`);
      const created = (await finish.json()) as { id?: string; path_display?: string };
      return {
        remoteId: created.id || remotePath,
        remotePath: created.path_display || remotePath,
        bytes: input.bytes.byteLength,
        service: "dropbox",
        accountEmail: "",
      };
    },
  };
}

export const DROPBOX_FORBIDDEN_OPS = ["files/delete", "files/delete_v2", "files/permanently_delete"] as const;
