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

/** Exact pCloud API hosts only (SSRF / DNS-rebinding guard). No suffix match. */
export const PCLOUD_API_HOSTS = ["api.pcloud.com", "eapi.pcloud.com"] as const;

export function resolvePcloudApiHost(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.MIND_PCLOUD_API_HOST || "api.pcloud.com").trim().toLowerCase();
  // hostname only — no scheme, path, userinfo, port, or IP literal
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)) {
    return "api.pcloud.com";
  }
  if (!(PCLOUD_API_HOSTS as readonly string[]).includes(raw)) {
    return "api.pcloud.com";
  }
  return raw;
}

function apiBase(host: string): string {
  return `https://${host}`;
}

function redactToken(text: string, token: string): string {
  if (!token) return text;
  return text.split(token).join("[redacted]");
}

function safePcloudError(status: number, resultCode: number | undefined, token: string): string {
  const base =
    typeof resultCode === "number" && resultCode !== 0
      ? `pCloud returned result=${resultCode}`
      : `pCloud request failed (HTTP ${status})`;
  return redactToken(base, token);
}

type PcloudJson = {
  result?: number;
  error?: string;
  metadata?: Array<{ fileid?: number | string; name?: string; path?: string }>;
  fileids?: Array<number | string>;
  usedquota?: number;
  quota?: number;
  email?: string;
};

/**
 * pCloud adapter: PUT /uploadfile + /userinfo for health/quota.
 * Access tokens are long-lived (no refresh). Never deletes remote media.
 */
export function createPcloudProvider(
  fetchImpl: FetchLike = fetch,
  env: Record<string, string | undefined> = process.env,
): StorageProvider {
  const host = resolvePcloudApiHost(env);
  const base = apiBase(host);

  return {
    service: "pcloud",

    async health(accessToken: string | null): Promise<StorageHealth> {
      if (!accessToken) {
        return { ok: true, connected: false, detail: "pCloud is not connected." };
      }
      try {
        const url = new URL(`${base}/userinfo`);
        url.searchParams.set("access_token", accessToken);
        const res = await fetchImpl(url.toString(), { method: "GET", headers: { accept: "application/json" } });
        if (res.status === 401 || res.status === 403) {
          return { ok: true, connected: false, detail: "pCloud refused the token. Reconnect the account." };
        }
        if (!res.ok) {
          return { ok: false, connected: false, detail: `pCloud health check returned ${res.status}.` };
        }
        const body = (await res.json()) as PcloudJson;
        if (body.result !== 0) {
          return {
            ok: true,
            connected: false,
            detail: safePcloudError(res.status, body.result, accessToken),
          };
        }
        return { ok: true, connected: true, detail: "pCloud reachable." };
      } catch {
        return { ok: false, connected: false, detail: "pCloud could not be reached." };
      }
    },

    async quota(accessToken: string): Promise<StorageQuota> {
      const url = new URL(`${base}/userinfo`);
      url.searchParams.set("access_token", accessToken);
      const res = await fetchImpl(url.toString(), { method: "GET", headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`pCloud quota returned ${res.status}`);
      const body = (await res.json()) as PcloudJson;
      if (body.result !== 0) {
        throw new Error(safePcloudError(res.status, body.result, accessToken));
      }
      const used = Number(body.usedquota ?? NaN);
      const total = Number(body.quota ?? NaN);
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
      const folderPath = `/${folders.join("/")}`;
      const remotePath = `${folderPath}/${fileName}`;

      // Ensure each folder segment exists (idempotent). Deep paths can 2002 if a parent is missing.
      let built = "";
      for (const segment of folders) {
        built += `/${segment}`;
        const ensureUrl = new URL(`${base}/createfolderifnotexists`);
        ensureUrl.searchParams.set("access_token", input.accessToken);
        ensureUrl.searchParams.set("path", built);
        const ensureRes = await fetchImpl(ensureUrl.toString(), {
          method: "GET",
          headers: { accept: "application/json" },
        });
        if (!ensureRes.ok) {
          throw new Error(safePcloudError(ensureRes.status, undefined, input.accessToken));
        }
        const ensureBody = (await ensureRes.json().catch(() => ({}))) as PcloudJson;
        if (typeof ensureBody.result === "number" && ensureBody.result !== 0) {
          throw new Error(safePcloudError(ensureRes.status, ensureBody.result, input.accessToken));
        }
      }

      const uploadUrl = new URL(`${base}/uploadfile`);
      uploadUrl.searchParams.set("access_token", input.accessToken);
      uploadUrl.searchParams.set("path", folderPath);
      uploadUrl.searchParams.set("filename", fileName);
      uploadUrl.searchParams.set("nopartial", "1");

      const res = await fetchImpl(uploadUrl.toString(), {
        method: "PUT",
        headers: {
          "content-type": input.mimeType || "application/octet-stream",
          accept: "application/json",
          // pCloud requires Content-Length / identity encoding (no chunked).
          "content-length": String(input.bytes.byteLength),
        },
        body: asBody(input.bytes),
      });

      let body: PcloudJson = {};
      try {
        body = (await res.json()) as PcloudJson;
      } catch {
        body = {};
      }

      if (!res.ok || body.result !== 0) {
        throw new Error(safePcloudError(res.status, body.result, input.accessToken));
      }

      const meta = Array.isArray(body.metadata) ? body.metadata[0] : undefined;
      const fileId =
        (meta && (meta.fileid != null ? String(meta.fileid) : undefined)) ||
        (Array.isArray(body.fileids) && body.fileids[0] != null ? String(body.fileids[0]) : undefined);
      if (!fileId) {
        throw new Error("pCloud upload returned no file id.");
      }

      return {
        remoteId: fileId,
        remotePath: (meta && typeof meta.path === "string" && meta.path) || remotePath,
        bytes: input.bytes.byteLength,
        service: "pcloud",
        accountEmail: "",
      };
    },
  };
}

export const PCLOUD_FORBIDDEN_OPS = ["deletefile", "deletefolder", "trash"] as const;
