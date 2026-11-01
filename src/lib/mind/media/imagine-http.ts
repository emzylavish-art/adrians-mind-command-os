import { requireUserId } from "@/lib/auth/verify.server";
import { decideFetchSite } from "@/lib/mind/request-guard";
import { MAX_IMAGINE_BODY_CHARS, checkImagineRateLimit, mapImagineHttpError } from "./harden.ts";
import { editImagineImage, generateImagineImages, normalizeImaginePrompt, resolveImagineModel } from "./imagine.ts";
import { normalizeImageDataUrl } from "./data-url.ts";

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

  const rate = checkImagineRateLimit(userId);
  if (!rate.ok) {
    return new Response(JSON.stringify({ ok: false, error: rate.error }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "retry-after": String(rate.retryAfterSec),
      },
    });
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const normalized = normalizeImaginePrompt(record.prompt);
  if (!normalized.ok) return json({ ok: false, error: normalized.error }, 400);

  const n = typeof record.n === "number" ? record.n : typeof record.count === "number" ? record.count : 1;
  const model = resolveImagineModel(record.model);
  const rawImage = typeof record.image === "string" ? record.image : typeof record.imageDataUrl === "string" ? record.imageDataUrl : "";
  const imageDataUrl = rawImage ? normalizeImageDataUrl(rawImage) || "" : "";
  const imageDataUrls = (
    Array.isArray(record.images)
      ? record.images
      : Array.isArray(record.imageDataUrls)
        ? record.imageDataUrls
        : []
  )
    .filter((item): item is string => typeof item === "string")
    .map((item) => normalizeImageDataUrl(item))
    .filter((item): item is string => Boolean(item));
  if (rawImage && !imageDataUrl) {
    return json({ ok: false, error: "The edit image is not a recognizable PNG, JPEG, GIF, or WebP." }, 400);
  }
  const mode = record.mode === "edit" || imageDataUrl || imageDataUrls.length ? "edit" : "generate";

  const result =
    mode === "edit"
      ? await editImagineImage({
          prompt: normalized.prompt,
          imageDataUrl: imageDataUrl || undefined,
          imageDataUrls: imageDataUrls.length ? imageDataUrls : undefined,
          model,
          responseFormat: "b64_json",
        })
      : await generateImagineImages({
          prompt: normalized.prompt,
          n,
          model,
          responseFormat: "b64_json",
        });

  if (!result.ok) {
    const status = result.status && result.status >= 400 && result.status < 600 ? result.status : 502;
    const error = mapImagineHttpError(status, result.error);
    return json({ ok: false, error, model }, status);
  }

  return json({
    ok: true,
    model: result.model,
    images: result.images.map((image, index) => ({
      dataUrl: image.dataUrl,
      mime: image.mime,
      name: `imagine-${index + 1}.${image.mime === "image/png" ? "png" : image.mime === "image/webp" ? "webp" : "jpg"}`,
    })),
  });
}
