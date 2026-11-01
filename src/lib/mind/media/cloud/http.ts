import { requireUserId } from "@/lib/auth/verify.server";
import { decideFetchSite } from "@/lib/mind/request-guard";
import {
  allCloudConnectionStatuses,
  cloudConnectionStatus,
  resolveCloudAccessToken,
} from "./connection.ts";
import { fetchGoogleDriveFile, listGoogleDriveFiles } from "./drive.ts";
import { fetchOneDriveFile, listOneDriveFiles } from "./onedrive.ts";
import { packageCloudFetchForComposer } from "./attach.ts";
import type { CloudSource } from "./types.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function userIdFrom(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  return requireUserId(bearer);
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

function parseSource(value: unknown): CloudSource | null {
  return value === "google_drive" || value === "onedrive" ? value : null;
}

export async function handleCloudStatus(request: Request): Promise<Response> {
  const blocked = guardSite(request);
  if (blocked) return blocked;
  try {
    const userId = await userIdFrom(request);
    return json({ ok: true, sources: allCloudConnectionStatuses(userId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
  }
}

export async function handleCloudList(request: Request): Promise<Response> {
  const blocked = guardSite(request);
  if (blocked) return blocked;
  let userId: string;
  try {
    userId = await userIdFrom(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
  }
  const url = new URL(request.url);
  const source = parseSource(url.searchParams.get("source") ?? "google_drive");
  if (!source) return json({ ok: false, error: "Unknown cloud source." }, 400);
  const status = cloudConnectionStatus(userId, source);
  if (status.state !== "connected") {
    return json({ ok: false, error: status.detail, state: status.state, source });
  }
  if (source === "onedrive") {
    const listed = listOneDriveFiles({});
    return json({ ...listed, source, state: status.state });
  }
  const token = await resolveCloudAccessToken(userId, source);
  if (!token.ok) return json({ ok: false, error: token.error, state: status.state, source });
  const listed = await listGoogleDriveFiles({
    token: token.token,
    pageToken: url.searchParams.get("pageToken") || undefined,
    query: url.searchParams.get("q") || undefined,
  });
  return json({ ...listed, source, state: status.state });
}

export async function handleCloudFetch(request: Request): Promise<Response> {
  const blocked = guardSite(request);
  if (blocked) return blocked;
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  let userId: string;
  try {
    userId = await userIdFrom(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
  }
  let body: { source?: unknown; fileId?: unknown; name?: unknown; mimeType?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "That request could not be read." }, 400);
  }
  const source = parseSource(body.source ?? "google_drive");
  if (!source) return json({ ok: false, error: "Unknown cloud source." }, 400);
  const fileId = typeof body.fileId === "string" ? body.fileId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 180) : "drive-file";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream";
  if (!fileId) return json({ ok: false, error: "Pick a file first." }, 400);

  const status = cloudConnectionStatus(userId, source);
  if (status.state !== "connected") {
    return json({ ok: false, error: status.detail, state: status.state, source });
  }
  if (source === "onedrive") {
    return json(fetchOneDriveFile({ fileId, name }));
  }
  const token = await resolveCloudAccessToken(userId, source);
  if (!token.ok) return json({ ok: false, error: token.error, state: status.state, source });
  const fetched = await fetchGoogleDriveFile({
    token: token.token,
    fileId,
    name,
    mimeType,
  });
  if (!fetched.ok) return json(fetched);
  const packaged = packageCloudFetchForComposer(fetched);
  if (!packaged.ok) return json(packaged);
  if (packaged.kind === "image") {
    return json({
      ok: true,
      kind: "image",
      name: packaged.image.name,
      mime: packaged.image.mime,
      dataUrl: packaged.image.dataUrl,
      bytes: fetched.bytes,
      source,
    });
  }
  return json({
    ok: true,
    kind: "text",
    name: packaged.staged.name,
    text: packaged.staged.text,
    bytes: fetched.bytes,
    source,
  });
}
