import { externalResourceCall } from "../external-resource-call.server.ts";
import { withFailureEnvelope } from "../failure-envelope.ts";
import { durableMediaOperations, mediaPayloadHash, runMediaOnce, validMediaOperationId, type MediaOperationStore } from "./operations.server.ts";
import { haltIsOn } from "../halt.server.ts";
import { requireUserId } from "@/lib/auth/verify.server";
import { decideFetchSite } from "@/lib/mind/request-guard";
import {
  MAX_IMAGINE_BODY_CHARS,
  mapImagineHttpError,
  setImagineRateLimitStore,
} from "./harden.ts";
import { createFileRateLimitStore, resolveImagineRateLimitPath } from "./rate-limit-store.ts";
import { imagineUsage } from "./spend-ledger.ts";
import { editImagineImage, generateImagineImages, normalizeImaginePrompt, resolveImagineModel } from "./imagine.ts";
import { readOwnerVideo, startOwnerVideo } from "./video.ts";
import { normalizeImageDataUrl } from "./data-url.ts";
import { MAX_DATA_URL_CHARS } from "./types.ts";
import { validateCreativeParameters } from "./asset-lifecycle.ts";
import { randomUUID } from "node:crypto";
import { durableVideoJobs } from "./video-job-store.server.ts";
import { pollVideoJob, startVideoJob } from "./video-jobs.ts";
import { downloadOwnedVideo } from "./video-download.server.ts";

try {
  setImagineRateLimitStore(createFileRateLimitStore(resolveImagineRateLimitPath()));
} catch {
  /* memory store remains the default */
}
function mediaJson(body: unknown, status = 200, subsystem: "image" | "video" = "image", operationKind: "read" | "generation" = "generation") {
  const subject = body && typeof body === "object" && "kind" in body && body.kind === "video" ? "video" : subsystem;
  return new Response(JSON.stringify(withFailureEnvelope(body, { subsystem: subject, status, operationKind })), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
const json = mediaJson;

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

function clientErrorStatus(result: { status?: number; error: string }): number {
  if (result.status && result.status >= 400 && result.status < 500) return result.status;
  // Known client-fault messages without status → 400 (H6)
  if (/needs at least one image|Write a prompt|not a recognizable|too long|too large|invalid/i.test(result.error)) {
    return 400;
  }
  if (result.status && result.status >= 500) return result.status;
  return result.status && result.status >= 400 ? result.status : 502;
}

export async function handleImagineGenerate(request: Request): Promise<Response> {
  const blocked = guardSite(request);
  if (blocked) return blocked;

  let userId: string;
  try {
    const authorization = request.headers.get("authorization");
    const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
    userId = await requireUserId(bearer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json(
      { ok: false, error: message === "Unauthorized" ? "Sign in is required." : message },
      message === "Unauthorized" ? 401 : 403,
    );
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGINE_BODY_CHARS) {
    return json({ ok: false, error: "That Imagine request body is too large." }, 413);
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return json({ ok: false, error: "Request body could not be read." }, 400);
  }
  if (rawText.length > MAX_IMAGINE_BODY_CHARS) {
    return json({ ok: false, error: "That Imagine request body is too large." }, 413);
  }

  let body: unknown;
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    return json({ ok: false, error: "Request body must be JSON with a prompt." }, 400);
  }

  const sessionId =
    request.headers.get("x-amcos-session") ||
    request.headers.get("x-session-id") ||
    "default";
  // Rate limit + daily spend cap are enforced inside generateImagineImages / editImagineImage
  // via meter.ownerId so custom execute paths cannot bypass.

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (record.kind === "video" && ["status", "list", "download"].includes(String(record.action))) return handleOwnerVideo(userId, record);
  if (record.freeOnly === true) return json({ ok: false, error: "Free-only mode prevents a paid image or video request." }, 403);
  if (await haltIsOn(userId)) return json({ ok: false, error: "Emergency stop is on or unavailable. Generation was blocked." }, 403);
  if (record.kind === "video") return handleOwnerVideo(userId, record);
  const normalized = normalizeImaginePrompt(record.prompt);
  if (!normalized.ok) return json({ ok: false, error: normalized.error }, 400);

  const n = typeof record.n === "number" ? record.n : typeof record.count === "number" ? record.count : 1;
  // H4: allowlist only — unknown models collapse to grok-imagine-image
  const model = resolveImagineModel(record.model);
  const rawImage = typeof record.image === "string" ? record.image : typeof record.imageDataUrl === "string" ? record.imageDataUrl : "";
  if (rawImage && rawImage.length > MAX_DATA_URL_CHARS) {
    return json({ ok: false, error: "That edit image is too large." }, 413);
  }
  const imageDataUrl = rawImage ? normalizeImageDataUrl(rawImage) || "" : "";
  const rawImages = record.images ?? record.imageDataUrls;
  if (rawImages !== undefined && (!Array.isArray(rawImages) || rawImages.length > 4)) return json({ ok: false, error: "Choose at most four image inputs; the selection was not changed." }, 400);
  if (Array.isArray(rawImages) && rawImages.some(item => typeof item !== "string" || item.length > MAX_DATA_URL_CHARS || !normalizeImageDataUrl(item))) return json({ ok: false, error: "Every selected edit image must be valid. No image was silently omitted." }, 400);
  const imageDataUrls = (
    Array.isArray(record.images)
      ? record.images
      : Array.isArray(record.imageDataUrls)
        ? record.imageDataUrls
        : []
  )
    .filter((item): item is string => typeof item === "string")
    .map((item) => {
      if (item.length > MAX_DATA_URL_CHARS) return null;
      return normalizeImageDataUrl(item);
    })
    .filter((item): item is string => Boolean(item));
  if (rawImage && !imageDataUrl) {
    return json({ ok: false, error: "The edit image is not a recognizable PNG, JPEG, GIF, or WebP." }, 400);
  }
  const mode = record.mode === "edit" || imageDataUrl || imageDataUrls.length ? "edit" : "generate";
  if (mode === "edit" && !imageDataUrl && imageDataUrls.length === 0) {
    return json({ ok: false, error: "Edit with Imagine needs at least one image data URL as input." }, 400);
  }

  const meter = { ownerId: userId, sessionId, operationId: typeof record.operationId === "string" ? record.operationId : request.headers.get("x-mind-operation-id") || undefined, taskId: typeof record.taskId === "string" ? record.taskId : undefined, projectId: typeof record.projectId === "string" ? record.projectId : undefined };
  // Shared adapter enforces account requests and image allowance for HTTP and agent paths exactly once.
  const result =
    mode === "edit"
      ? await editImagineImage(
          {
            prompt: normalized.prompt,
            imageDataUrl: imageDataUrl || undefined,
            imageDataUrls: imageDataUrls.length ? imageDataUrls : undefined,
            model,
            responseFormat: "b64_json",
          },
          { meter },
        )
      : await generateImagineImages(
          {
            prompt: normalized.prompt,
            n,
            model,
            responseFormat: "b64_json",
          },
          { meter },
        );

  if (!result.ok) {
    const status = clientErrorStatus(result);
    const error = mapImagineHttpError(status, result.error);
    // Do not echo the requested arbitrary model id back when rejecting — return allowlisted model only.
    return json({ ok: false, error, provider: "xai", model, approvalId: result.approvalId }, status);
  }

  return json({
    ok: true,
    provider: "xai",
    model: result.reportedModel,
    requestedModel: model,
    images: result.images.map((image, index) => ({
      dataUrl: image.dataUrl,
      mime: image.mime,
      name: `imagine-${index + 1}.${image.mime === "image/png" ? "png" : image.mime === "image/webp" ? "webp" : "jpg"}`,
    })),
  });
}

async function handleOwnerVideo(userId: string, record: Record<string, unknown>): Promise<Response> {
  try {
    const store = await durableVideoJobs();
    if (record.action === "list") return json({ ok: true, jobs: await store.list(userId) });
    if (record.action === "download") {
      const result = await downloadOwnedVideo(userId, typeof record.operationId === "string" ? record.operationId : "", store);
      if (!result.ok) return json(result, result.status);
      return new Response(new Uint8Array(result.bytes).buffer, { headers: { "content-type": result.mime, "cache-control": "no-store", "content-disposition": 'attachment; filename="adrian-video.' + (result.mime === "video/mp4" ? "mp4" : "webm") + '"' } });
    }
    if (record.action === "status") {
      const result = await pollVideoJob(userId, { operationId: typeof record.operationId === "string" ? record.operationId : undefined, requestId: typeof record.requestId === "string" ? record.requestId : undefined }, { store, status: readOwnerVideo });
      return json(result, result.ok ? 200 : result.status);
    }
    if (record.action !== "start" && record.action !== "retry_blocked" && record.action !== undefined) return json({ ok: false, error: "Unknown video operation." }, 400);
    const operationId = typeof record.operationId === "string" ? record.operationId : randomUUID();
    const result = await startVideoJob(userId, { operationId, retryBlocked: record.action === "retry_blocked", projectId: typeof record.projectId === "string" ? record.projectId : undefined, taskId: typeof record.taskId === "string" ? record.taskId : undefined, chatId: typeof record.chatId === "string" ? record.chatId : "", prompt: record.prompt, duration: record.duration, aspectRatio: record.aspectRatio, resolution: record.resolution, temporary: record.temporary === true }, { store, start: input => startOwnerVideo(input, { ownerId: userId, operationId, taskId: typeof record.taskId === "string" ? record.taskId : operationId, projectId: typeof record.projectId === "string" ? record.projectId : undefined }) });
    return json(result, result.ok ? 200 : result.status);
  } catch {
    return json({ ok: false, error: "Media recovery storage is unavailable or its update could not be confirmed. The original provider request may still be active. Do not submit another generation before reconciling it." }, 503);
  }
}

export async function handleImagineStatus(request: Request): Promise<Response> {
  const blocked = guardSite(request);
  if (blocked) return blocked;

  let userId: string;
  try {
    const authorization = request.headers.get("authorization");
    const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
    userId = await requireUserId(bearer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json(
      { ok: false, error: message === "Unauthorized" ? "Sign in is required." : message },
      message === "Unauthorized" ? 401 : 403,
    );
  }

  try {
    return json({ ok: true, ...await imagineUsage(userId) });
  } catch {
    return json({ ok: false, error: "Image usage could not be verified." }, 503);
  }
}
