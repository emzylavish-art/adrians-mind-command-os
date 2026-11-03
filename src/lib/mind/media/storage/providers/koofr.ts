import {
  MEDIA_REMOTE_ROOT,
  type StorageHealth,
  type StorageProvider,
  type StorageQuota,
  type StorageUploadInput,
  type StorageUploadResult,
} from "../types.ts";
import { sanitizeFolderSegments, sanitizeStorageFileName } from "../safe-name.ts";
import { packKoofrBasicToken } from "../credentials.ts";

type FetchLike = typeof fetch;

function asBody(bytes: Uint8Array): BodyInit {
  return Buffer.from(bytes) as unknown as BodyInit;
}

/** Exact Koofr WebDAV host only (SSRF / DNS-rebinding guard). */
export const KOOFR_DAV_HOST = "app.koofr.net" as const;
export const KOOFR_DAV_ROOT = "/dav/Koofr";
export const KOOFR_FETCH_TIMEOUT_MS = 30_000;

export { packKoofrBasicToken };

export function koofrAuthorizationHeader(basicTokenBase64: string): string {
  return `Basic ${basicTokenBase64}`;
}

function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  let out = text.split(secret).join("[redacted]");
  // Also redact common Basic-auth encodings of the secret fragment.
  try {
    const b64 = Buffer.from(secret, "utf8").toString("base64");
    if (b64.length > 8) out = out.split(b64).join("[redacted]");
  } catch {
    /* ignore */
  }
  return out;
}

function safeKoofrError(status: number, basicToken: string): string {
  return redactSecret(`Koofr WebDAV request failed (HTTP ${status})`, basicToken);
}

/**
 * Build and validate a Koofr WebDAV URL. Host must be exactly app.koofr.net over https.
 */
export function buildKoofrDavUrl(pathSegments: string[]): string {
  const cleaned = pathSegments
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .map((s) => encodeURIComponent(s));
  const path = `${KOOFR_DAV_ROOT}/${cleaned.join("/")}`;
  const url = new URL(`https://${KOOFR_DAV_HOST}${path}`);
  if (url.protocol !== "https:") throw new Error("Koofr URL must be https.");
  if (url.hostname.toLowerCase() !== KOOFR_DAV_HOST) {
    throw new Error("Koofr URL host is not allowed.");
  }
  if (url.username || url.password) throw new Error("Koofr URL must not include credentials.");
  if (url.port && url.port !== "443") throw new Error("Koofr URL port is not allowed.");
  return url.toString();
}

async function koofrFetch(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit & { basicToken: string },
): Promise<Response> {
  // Re-validate host on every call (defense in depth).
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== KOOFR_DAV_HOST) {
    throw new Error("Koofr URL host is not allowed.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Koofr URL must not include credentials.");
  }

  const { basicToken, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KOOFR_FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      ...rest,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        ...(rest.headers || {}),
        authorization: koofrAuthorizationHeader(basicToken),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ensure each collection exists via MKCOL (201 created / 405 already exists).
 */
async function ensureCollections(
  fetchImpl: FetchLike,
  basicToken: string,
  folders: string[],
): Promise<void> {
  const built: string[] = [];
  for (const segment of folders) {
    built.push(segment);
    const url = buildKoofrDavUrl(built);
    const res = await koofrFetch(fetchImpl, url, {
      method: "MKCOL",
      basicToken,
    });
    // 201 Created, 405 Method Not Allowed / 409 Conflict → already exists
    if (res.status >= 300 && res.status < 400) {
      throw new Error(safeKoofrError(res.status, basicToken));
    }
    if (res.status === 201 || res.status === 405 || res.status === 409 || res.status === 200) {
      continue;
    }
    // Some servers return 403 for existing collections; treat as ok only if PROPFIND works.
    if (res.status === 403 || res.status === 401) {
      throw new Error(safeKoofrError(res.status, basicToken));
    }
    if (!res.ok && res.status !== 405) {
      // Ignore "already exists" style responses; otherwise fail honestly.
      if (res.status !== 409) {
        throw new Error(safeKoofrError(res.status, basicToken));
      }
    }
  }
}

/**
 * Koofr adapter: WebDAV PUT under https://app.koofr.net/dav/Koofr/...
 * Auth is HTTP Basic with a long-lived app password (no OAuth refresh).
 * Intentionally has NO delete / DELETE methods.
 */
export function createKoofrProvider(fetchImpl: FetchLike = fetch): StorageProvider {
  return {
    service: "koofr",

    async health(accessToken: string | null): Promise<StorageHealth> {
      if (!accessToken) {
        return { ok: true, connected: false, detail: "Koofr is not connected." };
      }
      try {
        const url = buildKoofrDavUrl([]);
        const res = await koofrFetch(fetchImpl, url, {
          method: "PROPFIND",
          basicToken: accessToken,
          headers: { depth: "0", accept: "*/*" },
        });
        if (res.status === 401 || res.status === 403) {
          return {
            ok: true,
            connected: false,
            detail: "Koofr refused the app password. Update MIND_KOOFR_APP_PASSWORD.",
          };
        }
        if (res.status >= 300 && res.status < 400) {
          return { ok: false, connected: false, detail: "Koofr health check was redirected." };
        }
        // 207 Multi-Status is success for PROPFIND
        if (res.status === 207 || res.ok) {
          return { ok: true, connected: true, detail: "Koofr WebDAV reachable." };
        }
        return { ok: false, connected: false, detail: `Koofr health check returned ${res.status}.` };
      } catch {
        return { ok: false, connected: false, detail: "Koofr could not be reached." };
      }
    },

    async quota(_accessToken: string): Promise<StorageQuota> {
      // Koofr free WebDAV does not expose a simple quota endpoint here; ledger fills gaps.
      return { usedBytes: 0, totalBytes: 0, source: "unknown" };
    },

    async upload(input: StorageUploadInput & { accessToken: string }): Promise<StorageUploadResult> {
      const fileName = sanitizeStorageFileName(input.fileName);
      const folders = [MEDIA_REMOTE_ROOT, ...sanitizeFolderSegments(input.folderSegments)];
      const remotePath = `/${folders.join("/")}/${fileName}`;

      await ensureCollections(fetchImpl, input.accessToken, folders);

      const url = buildKoofrDavUrl([...folders, fileName]);
      const res = await koofrFetch(fetchImpl, url, {
        method: "PUT",
        basicToken: input.accessToken,
        headers: {
          "content-type": input.mimeType || "application/octet-stream",
          "content-length": String(input.bytes.byteLength),
        },
        body: asBody(input.bytes),
      });

      if (res.status >= 300 && res.status < 400) {
        throw new Error(safeKoofrError(res.status, input.accessToken));
      }
      // 201 Created or 204 No Content / 200 OK are success for PUT
      if (!(res.status === 201 || res.status === 204 || res.status === 200 || res.ok)) {
        throw new Error(safeKoofrError(res.status, input.accessToken));
      }

      return {
        remoteId: remotePath,
        remotePath,
        bytes: input.bytes.byteLength,
        service: "koofr",
        accountEmail: "",
      };
    },
  };
}

export const KOOFR_FORBIDDEN_OPS = ["DELETE", "RMCOL", "destroy"] as const;
