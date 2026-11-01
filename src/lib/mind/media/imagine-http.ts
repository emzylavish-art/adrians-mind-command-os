import { requireUserId } from "@/lib/auth/verify.server";
import { decideFetchSite } from "@/lib/mind/request-guard";
import { editImagineImage, generateImagineImages, normalizeImaginePrompt, resolveImagineModel } from "./imagine.ts";

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

  try {
    const authorization = request.headers.get("authorization");
    const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
    await requireUserId(bearer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json(
      { ok: false, error: message === "Unauthorized" ? "Sign in is required." : message },
      message === "Unauthorized" ? 401 : 403,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Request body must be JSON with a prompt." }, 400);
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const normalized = normalizeImaginePrompt(record.prompt);
  if (!normalized.ok) return json({ ok: false, error: normalized.error }, 400);

  const n = typeof record.n === "number" ? record.n : typeof record.count === "number" ? record.count : 1;
  const model = resolveImagineModel(record.model);
  const imageDataUrl = typeof record.image === "string" ? record.image : typeof record.imageDataUrl === "string" ? record.imageDataUrl : "";
  const imageDataUrls = Array.isArray(record.images)
    ? record.images.filter((item): item is string => typeof item === "string" && item.startsWith("data:image/"))
    : Array.isArray(record.imageDataUrls)
      ? record.imageDataUrls.filter((item): item is string => typeof item === "string" && item.startsWith("data:image/"))
      : [];
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
    return json({ ok: false, error: result.error, model }, status);
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
