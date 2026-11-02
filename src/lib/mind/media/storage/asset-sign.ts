import { decideFetchSite } from "../../request-guard.ts";
import {
  ASSET_FALLBACK_TTL_SECONDS,
  ASSET_SIGNED_TTL_SECONDS,
  ASSET_URL_BATCH_MAX,
  parseAssetKey,
  publicAssetPath,
  type AssetBucket,
  type ParsedAssetKey,
} from "./asset-url.ts";
import { resolveStorageAccessToken, resolveSupabaseStorageOrigin } from "./credentials.ts";

type FetchLike = typeof fetch;

export type SignedAssetUrl = {
  url: string;
  expiresAt: string;
};

export type AssetSignDeps = {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  now?: number;
  /**
   * Session check. Defaults to `requireUserId` from the app auth module.
   * The shared dev user is not a signed-in session.
   */
  requireUserId?: (bearerToken?: string) => Promise<string>;
};

type ListedObject = {
  name?: unknown;
  id?: unknown;
};

const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_HITS = 60;

export function resetAssetUrlRateLimit() {
  hits.clear();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function rateLimited(bucket: string): boolean {
  const now = Date.now();
  const prev = (hits.get(bucket) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
  if (prev.length >= MAX_HITS) {
    hits.set(bucket, prev);
    return true;
  }
  prev.push(now);
  hits.set(bucket, prev);
  return false;
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "asset-url";
}

function fallback(key: string, now: number): SignedAssetUrl {
  return {
    url: publicAssetPath(key),
    expiresAt: new Date(now + ASSET_FALLBACK_TTL_SECONDS * 1000).toISOString(),
  };
}

function signed(url: string, now: number): SignedAssetUrl {
  return {
    url,
    expiresAt: new Date(now + ASSET_SIGNED_TTL_SECONDS * 1000).toISOString(),
  };
}

function encodeObjectKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function authHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    apikey: token,
    accept: "application/json",
    ...extra,
  };
}

async function projectFetch(
  fetchImpl: FetchLike,
  origin: string,
  token: string,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password) {
    throw new Error("Supabase Storage refused a non-project URL.");
  }
  if (url.href.includes(token) || [...url.searchParams.values()].some((value) => value === token)) {
    throw new Error("Supabase Storage refused an unsafe URL.");
  }
  return fetchImpl(url.toString(), {
    method: init.method,
    headers: authHeaders(token, init.headers),
    body: init.body,
    redirect: "error",
  });
}

async function namesInFolder(
  fetchImpl: FetchLike,
  origin: string,
  token: string,
  bucket: AssetBucket,
  prefix: string,
): Promise<Set<string> | null> {
  const names = new Set<string>();
  let offset = 0;
  for (let page = 0; page < 10; page += 1) {
    const res = await projectFetch(fetchImpl, origin, token, `/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return null;
    for (const row of rows as ListedObject[]) {
      if (!row || typeof row !== "object") continue;
      if (row.id == null) continue;
      if (typeof row.name === "string" && row.name) names.add(row.name);
    }
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  return names;
}

function absoluteSignedUrl(origin: string, signedURL: unknown, serviceKey: string, bucket: AssetBucket): string | null {
  if (typeof signedURL !== "string" || !signedURL || signedURL.includes(serviceKey)) return null;
  let url: URL;
  try {
    if (signedURL.startsWith("/object/")) url = new URL(`/storage/v1${signedURL}`, origin);
    else if (signedURL.startsWith("https://")) url = new URL(signedURL);
    else return null;
  } catch {
    return null;
  }
  if (url.origin !== origin || url.username || url.password) return null;
  if (!url.pathname.startsWith(`/storage/v1/object/sign/${bucket}/`)) return null;
  if (url.href.includes(serviceKey)) return null;
  return url.toString();
}

async function createSignedUrl(
  fetchImpl: FetchLike,
  origin: string,
  token: string,
  bucket: AssetBucket,
  objectKey: string,
): Promise<string | null> {
  const res = await projectFetch(
    fetchImpl,
    origin,
    token,
    `/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeObjectKey(objectKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: ASSET_SIGNED_TTL_SECONDS }),
    },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { signedURL?: unknown; signedUrl?: unknown };
  return absoluteSignedUrl(origin, body.signedURL ?? body.signedUrl, token, bucket);
}

async function createSignedUrls(
  fetchImpl: FetchLike,
  origin: string,
  token: string,
  bucket: AssetBucket,
  objectKeys: string[],
): Promise<Map<string, string>> {
  const signedUrls = new Map<string, string>();
  if (objectKeys.length === 0) return signedUrls;
  if (objectKeys.length === 1) {
    const objectKey = objectKeys[0] ?? "";
    const url = await createSignedUrl(fetchImpl, origin, token, bucket, objectKey);
    if (url) signedUrls.set(objectKey, url);
    return signedUrls;
  }
  const res = await projectFetch(fetchImpl, origin, token, `/storage/v1/object/sign/${encodeURIComponent(bucket)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: ASSET_SIGNED_TTL_SECONDS, paths: objectKeys }),
  });
  if (!res.ok) return signedUrls;
  const rows = (await res.json()) as { path?: unknown; signedURL?: unknown; signedUrl?: unknown; error?: unknown }[];
  if (!Array.isArray(rows)) return signedUrls;
  for (let index = 0; index < objectKeys.length; index += 1) {
    const objectKey = objectKeys[index] ?? "";
    const row = rows.find((item) => item?.path === objectKey) ?? rows[index];
    if (!row || row.error) continue;
    const url = absoluteSignedUrl(origin, row.signedURL ?? row.signedUrl, token, bucket);
    if (url) signedUrls.set(objectKey, url);
  }
  return signedUrls;
}

/**
 * Sign keys that exist in their bucket. Missing objects fall back to `/` + key.
 * The service key is used only on this server request and is never returned.
 * Caller must already have rejected private buckets for a signed-out session.
 */
export async function resolveBrandAssetUrls(
  targets: ParsedAssetKey[],
  deps: AssetSignDeps = {},
): Promise<Record<string, SignedAssetUrl>> {
  const now = deps.now ?? Date.now();
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const out: Record<string, SignedAssetUrl> = {};
  for (const target of targets) out[target.key] = fallback(target.key, now);

  const tokenResult = resolveStorageAccessToken("brand-assets", "supabase", env);
  const origin = resolveSupabaseStorageOrigin(env);
  if (!tokenResult.ok || !origin) return out;

  const folders = new Map<string, Set<string> | null>();
  const present: ParsedAssetKey[] = [];
  for (const target of targets) {
    const slash = target.objectKey.lastIndexOf("/");
    const prefix = slash >= 0 ? target.objectKey.slice(0, slash) : "";
    const name = slash >= 0 ? target.objectKey.slice(slash + 1) : target.objectKey;
    const folderKey = `${target.bucket}\n${prefix}`;
    if (!folders.has(folderKey)) {
      try {
        folders.set(folderKey, await namesInFolder(fetchImpl, origin, tokenResult.token, target.bucket, prefix));
      } catch {
        folders.set(folderKey, null);
      }
    }
    if (folders.get(folderKey)?.has(name)) present.push(target);
  }

  const byBucket = new Map<AssetBucket, ParsedAssetKey[]>();
  for (const target of present) {
    const group = byBucket.get(target.bucket) ?? [];
    group.push(target);
    byBucket.set(target.bucket, group);
  }
  for (const [bucket, group] of byBucket) {
    let signedUrls = new Map<string, string>();
    try {
      signedUrls = await createSignedUrls(
        fetchImpl,
        origin,
        tokenResult.token,
        bucket,
        group.map((target) => target.objectKey),
      );
    } catch {
      signedUrls = new Map();
    }
    for (const target of group) {
      const url = signedUrls.get(target.objectKey);
      if (url) out[target.key] = signed(url, now);
    }
  }
  return out;
}

function bearerFrom(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  return authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
}

/**
 * Existing session check (`requireUserId`). A missing session is 401.
 * Any other auth failure, including auth disabled against a real database, is 403.
 * The shared dev user is not a signed-in session.
 */
async function requireSignedIn(request: Request, deps: AssetSignDeps): Promise<Response | null> {
  const check = deps.requireUserId ?? defaultRequireUserId;
  try {
    const userId = await check(bearerFrom(request));
    // "dev-user" is requireUserId's signed-out fallback, not a session.
    if (!userId || userId === "dev-user") {
      return json({ error: "Sign in is required." }, 401);
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    const status = typeof error === "object" && error != null && "status" in error && (error as { status?: number }).status === 401;
    if (status || message === "Unauthorized") {
      return json({ error: "Sign in is required." }, 401);
    }
    return json({ error: "Forbidden." }, 403);
  }
}

async function defaultRequireUserId(bearerToken?: string): Promise<string> {
  const { requireUserId, DEV_USER_ID } = await import("../../../auth/verify.server.ts");
  const userId = await requireUserId(bearerToken);
  if (userId === DEV_USER_ID) {
    const error = new Error("Unauthorized") as Error & { status: number };
    error.status = 401;
    throw error;
  }
  return userId;
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
    return json({ error: "Forbidden: cross-site request blocked" }, 403);
  }
  return null;
}

function targetsFrom(values: unknown[]): ParsedAssetKey[] | Response {
  const targets: ParsedAssetKey[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const target = parseAssetKey(value);
    if (!target) return json({ error: "Invalid asset key." }, 400);
    if (seen.has(target.key)) continue;
    seen.add(target.key);
    targets.push(target);
  }
  return targets;
}

/**
 * GET /api/mind/media/asset-url?key=
 * POST /api/mind/media/asset-url { keys }
 *
 * Signed-out callers may only sign `media-brand` (site assets).
 * `media-images`, `media-video`, `media-audio`, and `media-camera` require
 * the app session check. The service key stays on the server.
 */
export async function handleAssetUrl(request: Request, deps: AssetSignDeps = {}): Promise<Response> {
  const blocked = guardSite(request);
  if (blocked) return blocked;
  if (rateLimited(clientKey(request))) {
    return json({ error: "Too many asset URL requests. Wait a minute and try again." }, 429);
  }

  let targets: ParsedAssetKey[];
  if (request.method === "GET") {
    const parsed = targetsFrom([new URL(request.url).searchParams.get("key")]);
    if (parsed instanceof Response) return parsed;
    targets = parsed;
  } else if (request.method === "POST") {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > 32_768) {
      return json({ error: "Request body is too large." }, 413);
    }
    let body: { keys?: unknown };
    try {
      body = (await request.json()) as { keys?: unknown };
    } catch {
      return json({ error: "Request body must be JSON." }, 400);
    }
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      return json({ error: "keys must be a non-empty array." }, 400);
    }
    if (body.keys.length > ASSET_URL_BATCH_MAX) {
      return json({ error: `At most ${ASSET_URL_BATCH_MAX} keys can be signed at once.` }, 400);
    }
    const parsed = targetsFrom(body.keys);
    if (parsed instanceof Response) return parsed;
    targets = parsed;
  } else {
    return json({ error: "Method not allowed." }, 405);
  }

  if (targets.some((target) => target.private)) {
    const denied = await requireSignedIn(request, deps);
    if (denied) return denied;
  }

  const urls = await resolveBrandAssetUrls(targets, deps);
  if (request.method === "GET") return json(urls[targets[0]?.key ?? ""]);
  return json({ urls });
}
