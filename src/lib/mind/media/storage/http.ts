import { requireUserId } from "@/lib/auth/verify.server";
import { decideFetchSite } from "@/lib/mind/request-guard";
import { storeMedia, storageStatusForOwner } from "./rotation.ts";
import { MAX_UPLOAD_BYTES } from "./types.ts";
import { sanitizeFolderSegments, sanitizeStorageFileName } from "./safe-name.ts";

/** Simple in-memory rate limit for storage routes (per user). */
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_HITS = 30;

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const prev = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (prev.length >= MAX_HITS) {
    hits.set(userId, prev);
    return true;
  }
  prev.push(now);
  hits.set(userId, prev);
  return false;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function guardSite(request: Request): Response | null {
  if (
    decideFetchSite({
      site: request.headers.get("sec-fetch-site"),
      mode: request.headers.get("sec-fetch-mode"),
      dest: request.headers.get("sec-fetch-dest"),
      method: request.method,
    }) === "block"
  ) {
    return json({ ok: false, error: "Forbidden: cross-site request blocked" }, 403);
  }
  return null;
}

async function userIdFrom(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  return requireUserId(bearer);
}

function stripSecrets(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replace(/sl\.[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[REDACTED]");
}

function mediaKindFromBody(value: unknown) {
  if (typeof value !== "string") return undefined;
  const kind = value.trim().toLowerCase();
  if (kind === "imagine" || kind === "images" || kind === "image") return "image" as const;
  if (kind === "camera" || kind === "video" || kind === "audio" || kind === "unknown") return kind;
  return undefined;
}

/**
 * POST /api/mind/media/storage/upload
 * Body JSON: { fileName, mimeType?, base64, folderSegments? }
 * No user-supplied upload URLs (SSRF-safe). Auth required. Size-capped.
 */
export async function handleStorageUpload(request: Request): Promise<Response> {
  const blocked = guardSite(request);
  if (blocked) return blocked;
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  let userId: string;
  try {
    userId = await userIdFrom(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json(
      { ok: false, error: message === "Unauthorized" ? "Sign in is required." : stripSecrets(message) },
      message === "Unauthorized" ? 401 : 403,
    );
  }

  if (rateLimited(userId)) {
    return json({ ok: false, error: "Too many storage uploads. Wait a minute and try again." }, 429);
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  // base64 expands ~4/3; allow envelope overhead
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES * 2 + 4096) {
    return json({ ok: false, error: "Upload body is too large." }, 413);
  }

  let body: {
    fileName?: unknown;
    mimeType?: unknown;
    base64?: unknown;
    folderSegments?: unknown;
    mediaKind?: unknown;
    /** Rejected: never accept remote URLs to fetch (SSRF). */
    url?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "Request body must be JSON." }, 400);
  }

  if (body.url != null) {
    return json({ ok: false, error: "Remote upload URLs are not allowed." }, 400);
  }

  if (typeof body.base64 !== "string" || !body.base64.trim()) {
    return json({ ok: false, error: "base64 payload is required." }, 400);
  }
  const cleaned = body.base64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
    return json({ ok: false, error: "base64 payload is invalid." }, 400);
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(cleaned, "base64"));
  } catch {
    return json({ ok: false, error: "base64 payload could not be decoded." }, 400);
  }
  if (bytes.byteLength === 0) return json({ ok: false, error: "Upload body is empty." }, 400);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return json({ ok: false, error: `File exceeds the ${MAX_UPLOAD_BYTES} byte upload cap.` }, 413);
  }

  const result = await storeMedia({
    ownerId: userId,
    bytes,
    fileName: sanitizeStorageFileName(body.fileName),
    mimeType: typeof body.mimeType === "string" ? body.mimeType : undefined,
    folderSegments: sanitizeFolderSegments(body.folderSegments ?? ["media"]),
    mediaKind: mediaKindFromBody(body.mediaKind),
  });

  if (!result.ok) {
    const status =
      result.code === "unauthorized"
        ? 401
        : result.code === "invalid_input"
          ? 400
          : result.code === "not_connected"
            ? 503
            : result.code === "storage_full"
              ? 507
              : 502;
    return json({ ok: false, error: stripSecrets(result.error), code: result.code }, status);
  }

  return json({
    ok: true,
    service: result.service,
    accountEmail: result.accountEmail,
    remoteId: result.remoteId,
    remotePath: result.remotePath,
    bytes: result.bytes,
    usedBytes: result.usedBytes,
    capBytes: result.capBytes,
    switchedFrom: result.switchedFrom,
  });
}

/** GET /api/mind/media/storage/status — per-account used/cap + connected state. */
export async function handleStorageStatus(request: Request): Promise<Response> {
  const blocked = guardSite(request);
  if (blocked) return blocked;

  let userId: string;
  try {
    userId = await userIdFrom(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json(
      { ok: false, error: message === "Unauthorized" ? "Sign in is required." : stripSecrets(message) },
      message === "Unauthorized" ? 401 : 403,
    );
  }

  if (rateLimited(`status:${userId}`)) {
    return json({ ok: false, error: "Too many status requests. Wait a minute and try again." }, 429);
  }

  const accounts = await storageStatusForOwner(userId);
  return json({ ok: true, accounts });
}
