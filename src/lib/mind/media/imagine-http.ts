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
import { createFileRateLimitStore, DEFAULT_IMAGINE_RATE_LIMIT_PATH } from "./rate-limit-store.ts";
import { imagineUsage } from "./spend-ledger.ts";
import { editImagineImage, generateImagineImages, normalizeImaginePrompt, resolveImagineModel } from "./imagine.ts";
import { readOwnerVideo, startOwnerVideo } from "./video.ts";
import { normalizeImageDataUrl } from "./data-url.ts";
import { MAX_DATA_URL_CHARS } from "./types.ts";
import { validateCreativeParameters } from "./asset-lifecycle.ts";

try {
  setImagineRateLimitStore(createFileRateLimitStore(DEFAULT_IMAGINE_RATE_LIMIT_PATH));
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
  if (record.action === "recover") {
    const store = await durableMediaOperations();
    if (validMediaOperationId(record.operationId)) {
      const operation = await store.get(userId, record.operationId);
      return operation ? json({ ok: true, operation }) : json({ ok: false, error: "Media operation not found." }, 404);
    }
    return json({ ok: true, operations: await store.list(userId) });
  }
  if (record.kind === "video" && record.action === "status") return handleOwnerVideo(record, userId);
  if (record.freeOnly === true) return json({ ok: false, code: "free_only", dispatched: false, kind: record.kind === "video" ? "video" : "image", error: "Free-only mode prevents a paid image or video request." }, 403);
  if (await haltIsOn(userId)) return json({ ok: false, code: "emergency_stop", dispatched: false, kind: record.kind === "video" ? "video" : "image", error: "Emergency stop is on or unavailable. Generation was blocked." }, 403);
  if (record.kind === "video") return handleOwnerVideo(record, userId);
  const normalized = normalizeImaginePrompt(record.prompt);
  if (!normalized.ok) return json({ ok: false, error: normalized.error }, 400);

  const n = typeof record.n === "number" ? record.n : typeof record.count === "number" ? record.count : 1;
  const invalid = validateCreativeParameters({ kind: "image", count: n });
  if (invalid) return json({ ok: false, error: invalid, dispatched: false }, 400);
  // H4: allowlist only — unknown models collapse to grok-imagine-image
  const model = resolveImagineModel(record.model);
  const rawImage = typeof record.image === "string" ? record.image : typeof record.imageDataUrl === "string" ? record.imageDataUrl : "";
  if (rawImage && rawImage.length > MAX_DATA_URL_CHARS) {
    return json({ ok: false, error: "That edit image is too large." }, 413);
  }
  const imageDataUrl = rawImage ? normalizeImageDataUrl(rawImage) || "" : "";
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

  const meter = { ownerId: userId, sessionId };
  const dispatch = async () =>
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

  const operationId = validMediaOperationId(record.operationId) ? record.operationId : crypto.randomUUID();
  const result = await runMediaOnce(await durableMediaOperations(), userId, {
    id: operationId, kind: "image", payloadHash: mediaPayloadHash({ mode, prompt: normalized.prompt, imageDataUrl, imageDataUrls, model, n }),
    chatId: record.retainResult === false ? null : typeof record.chatId === "string" ? record.chatId : null, state: "dispatching", result: null, retainResult: record.retainResult !== false,
  }, async () => {
    const generated = await externalResourceCall({ owner: userId, provider: "xai", model, taskId: operationId }, dispatch);
    if (!generated.ok) return { ...generated };
    return { ...generated, model: generated.reportedModel, images: generated.images };
  });
  if (result.ok !== true) return json(result, typeof result.status === "number" ? result.status : 502);
  return json({ ...result, requestedModel: model });
}

async function handleOwnerVideo(record: Record<string, unknown>, owner: string): Promise<Response> {
  const json = (body: unknown, status = 200) => mediaJson(body, status, "video", record.action === "status" ? "read" : "generation");
  let store: MediaOperationStore;
  try { store = await durableMediaOperations(); }
  catch { return json({ ok: false, error: "Durable media recovery storage is unavailable. No generation started." }, 503); }
  if (record.action === "status") {
    if (!validMediaOperationId(record.operationId)) return json({ ok: false, error: "Select a saved video operation to check its status." }, 400);
    const op = await store.get(owner, record.operationId);
    if (!op || op.kind !== "video") return json({ ok: false, error: "Video operation not found." }, 404);
    if (op.state === "completed" || op.state === "failed") return json(op.result);
    const requestId = op.result?.requestId;
    if (typeof requestId !== "string") return json({ ok: false, state: "unknown", error: "Provider acceptance was not confirmed. Do not start another generation automatically." }, 409);
    const result = await readOwnerVideo(requestId);
    if (result.ok && result.state === "done") {
      const temporary = (op.result?.receipt as { retention?: string } | undefined)?.retention === "temporary_not_retained";
      op.state = "completed"; op.result = temporary
        ? { ok: false, code: "temporary_result_not_retained", status: 409, receipt: op.result?.receipt, error: "The temporary video result was delivered but its link was not retained." }
        : { ...op.result, ...result, retention: "provider_url_expires", expiresAt: null };
      await store.save(owner, op);
    } else if (!result.ok && result.state === "failed") {
      op.state = "failed"; op.result = { ...op.result, ...result }; await store.save(owner, op);
    }
    return json({ ...result, operationId: op.id }, result.ok ? 200 : result.status);
  }
  const operationId = validMediaOperationId(record.operationId) ? record.operationId : crypto.randomUUID();
  const prompt = typeof record.prompt === "string" ? record.prompt : "";
  const duration = typeof record.duration === "number" ? record.duration : 5;
  const invalid = validateCreativeParameters({ kind: "video", duration });
  if (invalid) return json({ ok: false, error: invalid, dispatched: false }, 400);
  const result = await runMediaOnce(store, owner, {
    id: operationId, kind: "video", payloadHash: mediaPayloadHash({ prompt, duration }),
    chatId: record.retainResult === false ? null : typeof record.chatId === "string" ? record.chatId : null, state: "dispatching", result: null, retainResult: record.retainResult !== false,
  }, () => externalResourceCall({ owner, provider: "xai", model: "grok-imagine-video-1.5-lite", taskId: operationId }, () => startOwnerVideo({ prompt, duration })));
  return json(result, result.ok ? 200 : typeof result.status === "number" ? result.status : 502);
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
