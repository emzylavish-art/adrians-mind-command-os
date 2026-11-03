import { IMAGINE_MAX_N, checkImagineRateLimit, imagineRateLimitKey, mapImagineHttpError } from "./harden.ts";
import { assertImagineSpendAllowed, getImagineSpendLedger } from "./spend-ledger.ts";
import { fetchPinnedUrl, resolveAndPinUrl, type LookupFn } from "./ssrf.ts";
import { resolveXaiInferenceApiKey } from "./xai-key.ts";
import { MAX_DATA_URL_CHARS, MAX_IMAGES_PER_TURN } from "./types.ts";
import {
  GROK_IMAGINE_MODEL,
  normalizeImaginePrompt,
  resolveImagineModel,
  XAI_IMAGES_EDITS_URL,
  XAI_IMAGES_GENERATIONS_URL,
} from "./imagine-shared.ts";

export {
  GROK_IMAGINE_MODEL,
  GROK_IMAGINE_QUALITY_MODEL,
  GROK_IMAGINE_MODELS,
  resolveImagineModel,
  normalizeImaginePrompt,
  parseImagineCommand,
  XAI_IMAGES_EDITS_URL,
  XAI_IMAGES_GENERATIONS_URL,
  XAI_IMAGE_VARIATIONS_SUPPORTED,
  XAI_MULTI_IMAGE_EDITS_SUPPORTED,
} from "./imagine-shared.ts";
export type { GrokImagineModel } from "./imagine-shared.ts";

export type ImagineRequest = {
  prompt: string;
  /** 1–4; capped at MAX_IMAGES_PER_TURN */
  n?: number;
  model?: string;
  /** Prefer b64_json so images persist without a remote URL. */
  responseFormat?: "b64_json" | "url";
};

export type ImagineImage = {
  dataUrl: string;
  mime: string;
  /** Present when the API returned a temporary URL that we downloaded. */
  sourceUrl?: string;
};

export type ImagineResult =
  | { ok: true; model: string; images: ImagineImage[]; usage?: unknown }
  | { ok: false; error: string; status?: number };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function clampCount(n: unknown): number {
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num) || num < 1) return 1;
  return Math.min(IMAGINE_MAX_N, MAX_IMAGES_PER_TURN, Math.floor(num));
}


function mimeFromB64Header(b64: string, hinted?: string): string {
  if (hinted && /^image\/(png|jpeg|jpg|gif|webp)$/i.test(hinted)) {
    return hinted.toLowerCase().replace("image/jpg", "image/jpeg");
  }
  try {
    const head = Buffer.from(b64.slice(0, 32), "base64");
    if (head[0] === 0x89 && head[1] === 0x50) return "image/png";
    if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
    if (head[0] === 0x47 && head[1] === 0x49) return "image/gif";
    if (head[0] === 0x52 && head[1] === 0x49) return "image/webp";
  } catch {
    /* ignore */
  }
  return "image/jpeg";
}

function dataUrlFromB64(b64: string, mimeHint?: string): { ok: true; dataUrl: string; mime: string } | { ok: false; error: string } {
  const cleaned = b64.replace(/\s+/g, "");
  if (!cleaned) return { ok: false, error: "The image API returned empty image data." };
  const mime = mimeFromB64Header(cleaned, mimeHint);
  const dataUrl = `data:${mime};base64,${cleaned}`;
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    return { ok: false, error: "A generated image was too large to keep as a data URL." };
  }
  return { ok: true, dataUrl, mime };
}

async function downloadUrlToDataUrl(
  url: string,
  fetchImpl: FetchLike,
  lookup?: LookupFn,
): Promise<{ ok: true; dataUrl: string; mime: string } | { ok: false; error: string }> {
  const pinned = await resolveAndPinUrl(url, lookup);
  if (!pinned.ok) return pinned;

  // Production: connect to the pinned address (no redirects).
  // Tests: after a successful pin check, a custom fetchImpl may supply bytes.
  if (fetchImpl !== fetch) {
    let response: Response;
    try {
      response = await fetchImpl(url, { method: "GET", redirect: "error" });
    } catch {
      return { ok: false, error: "Could not download the generated image URL." };
    }
    if (!response.ok) {
      return { ok: false, error: `Downloading the generated image failed (HTTP ${response.status}).` };
    }
    const contentType = (response.headers.get("content-type") || "image/jpeg").split(";")[0]!.trim();
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.byteLength > Math.floor(MAX_DATA_URL_CHARS * 0.75)) {
      return { ok: false, error: "Downloaded image exceeded the size cap." };
    }
    return dataUrlFromB64(buf.toString("base64"), contentType.startsWith("image/") ? contentType : "image/jpeg");
  }

  const downloaded = await fetchPinnedUrl(url, { lookup, maxBytes: Math.floor(MAX_DATA_URL_CHARS * 0.75) });
  if (!downloaded.ok) return downloaded;
  const b64 = downloaded.bytes.toString("base64");
  return dataUrlFromB64(b64, downloaded.contentType.startsWith("image/") ? downloaded.contentType : "image/jpeg");
}

/**
 * Call xAI Grok Imagine (`POST /v1/images/generations`).
 * Prefers b64_json; when only a URL is returned, downloads it server-side into a data URL.
 */
export async function generateImagineImages(
  input: ImagineRequest,
  options: {
    apiKey?: string;
    fetchImpl?: FetchLike;
    endpoint?: string;
    lookup?: LookupFn;
    /** Required for production spend controls (rate limit + daily ledger). */
    meter?: { ownerId: string; sessionId?: string };
    /** Test-only escape hatch — never set from HTTP/agent routes. */
    skipSpendControls?: boolean;
  } = {},
): Promise<ImagineResult> {
  const normalized = normalizeImaginePrompt(input.prompt);
  if (!normalized.ok) return normalized;

  const model = resolveImagineModel(input.model);
  const n = clampCount(input.n);

  if (!options.skipSpendControls) {
    const ownerId = options.meter?.ownerId?.trim() ?? "";
    if (!ownerId) {
      return { ok: false, error: "Imagine requires an owner id for spend controls.", status: 400 };
    }
    const allowed = assertImagineSpendAllowed({
      ownerId,
      sessionId: options.meter?.sessionId,
      n,
      checkRateLimit: checkImagineRateLimit,
      rateLimitKey: imagineRateLimitKey,
    });
    if (!allowed.ok) return { ok: false, error: allowed.error, status: allowed.status };
  }

  const apiKey = options.apiKey ?? resolveXaiInferenceApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: "Image generation is not configured on the server.",
      status: 503,
    };
  }
  const responseFormat = input.responseFormat ?? "b64_json";
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? XAI_IMAGES_GENERATIONS_URL;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: normalized.prompt,
        n,
        response_format: responseFormat,
      }),
    });
  } catch {
    return { ok: false, error: "Could not reach the xAI image generation endpoint.", status: 502 };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: `Image generation returned a non-JSON response (HTTP ${response.status}).`,
      status: response.status,
    };
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (!response.ok) {
    const err = record.error;
    const raw =
      typeof err === "string"
        ? err
        : err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
          ? String((err as { message: string }).message)
          : `Image generation failed (HTTP ${response.status}).`;
    return { ok: false, error: mapImagineHttpError(response.status, raw), status: response.status };
  }

  const rawData = Array.isArray(record.data) ? record.data : [];
  if (rawData.length === 0) {
    return { ok: false, error: "Image generation returned no images.", status: response.status };
  }

  const images: ImagineImage[] = [];
  for (const item of rawData) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.b64_json === "string" && row.b64_json) {
      const built = dataUrlFromB64(row.b64_json, typeof row.mime_type === "string" ? row.mime_type : undefined);
      if (!built.ok) return { ok: false, error: built.error, status: response.status };
      images.push({ dataUrl: built.dataUrl, mime: built.mime });
      continue;
    }
    if (typeof row.url === "string" && row.url) {
      const downloaded = await downloadUrlToDataUrl(row.url, fetchImpl, options.lookup);
      if (!downloaded.ok) return { ok: false, error: downloaded.error, status: response.status };
      images.push({ dataUrl: downloaded.dataUrl, mime: downloaded.mime, sourceUrl: row.url });
    }
  }

  if (images.length === 0) {
    return { ok: false, error: "Image generation returned no usable image payloads.", status: response.status };
  }

  const resolvedModel = typeof record.model === "string" && record.model ? record.model : model;
  if (!options.skipSpendControls && options.meter?.ownerId) {
    getImagineSpendLedger().record({ ownerId: options.meter.ownerId, model: resolvedModel, n: images.length || n });
  }
  return {
    ok: true,
    model: resolvedModel,
    images,
    usage: record.usage,
  };
}



export type ImagineEditRequest = {
  prompt: string;
  /** Single input (legacy). Prefer imageDataUrls for one or many. */
  imageDataUrl?: string;
  /** One or more data:image/... inputs. Live-confirmed: API accepts `image_urls: string[]`. */
  imageDataUrls?: string[];
  model?: string;
  responseFormat?: "b64_json" | "url";
};


export function collectEditImageUrls(input: ImagineEditRequest): string[] {
  const urls: string[] = [];
  for (const value of input.imageDataUrls ?? []) {
    if (typeof value === "string" && value.startsWith("data:image/")) urls.push(value);
  }
  if (typeof input.imageDataUrl === "string" && input.imageDataUrl.startsWith("data:image/")) {
    if (!urls.includes(input.imageDataUrl)) urls.unshift(input.imageDataUrl);
  }
  return urls.slice(0, 4);
}

/**
 * Edit one or more images with Grok Imagine via POST /v1/images/edits.
 * Single: `{ image_url }`. Multi (live-probed): `{ image_urls: [...] }`.
 * Multipart and raw-string `image` fields are rejected by the API.
 */
export async function editImagineImage(
  input: ImagineEditRequest,
  options: {
    apiKey?: string;
    fetchImpl?: FetchLike;
    endpoint?: string;
    lookup?: LookupFn;
    meter?: { ownerId: string; sessionId?: string };
    skipSpendControls?: boolean;
  } = {},
): Promise<ImagineResult> {
  const normalized = normalizeImaginePrompt(input.prompt);
  if (!normalized.ok) return normalized;
  const imageUrls = collectEditImageUrls(input);
  if (imageUrls.length === 0) {
    return { ok: false, error: "Edit with Imagine needs at least one image data URL as input.", status: 400 };
  }
  for (const imageUrl of imageUrls) {
    if (imageUrl.length > MAX_DATA_URL_CHARS) {
      return { ok: false, error: "That edit image is too large.", status: 413 };
    }
  }

  if (!options.skipSpendControls) {
    const ownerId = options.meter?.ownerId?.trim() ?? "";
    if (!ownerId) {
      return { ok: false, error: "Imagine requires an owner id for spend controls.", status: 400 };
    }
    const allowed = assertImagineSpendAllowed({
      ownerId,
      sessionId: options.meter?.sessionId,
      n: 1,
      checkRateLimit: checkImagineRateLimit,
      rateLimitKey: imagineRateLimitKey,
    });
    if (!allowed.ok) return { ok: false, error: allowed.error, status: allowed.status };
  }

  const apiKey = options.apiKey ?? resolveXaiInferenceApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: "Image editing is not configured on the server.",
      status: 503,
    };
  }

  const model = resolveImagineModel(input.model);
  const responseFormat = input.responseFormat ?? "b64_json";
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? XAI_IMAGES_EDITS_URL;

  const requestBody: Record<string, unknown> = {
    model,
    prompt: normalized.prompt,
    response_format: responseFormat,
  };
  if (imageUrls.length === 1) requestBody.image_url = imageUrls[0];
  else requestBody.image_urls = imageUrls;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } catch {
    return { ok: false, error: "Could not reach the xAI image edits endpoint.", status: 502 };
  }

  let responseJson: unknown;
  try {
    responseJson = await response.json();
  } catch {
    return {
      ok: false,
      error: `Image editing returned a non-JSON response (HTTP ${response.status}).`,
      status: response.status,
    };
  }

  const record = responseJson && typeof responseJson === "object" ? (responseJson as Record<string, unknown>) : {};
  if (!response.ok) {
    const err = record.error;
    const raw =
      typeof err === "string"
        ? err
        : err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
          ? String((err as { message: string }).message)
          : `Image editing failed (HTTP ${response.status}).`;
    return { ok: false, error: mapImagineHttpError(response.status, raw), status: response.status };
  }

  const rawData = Array.isArray(record.data) ? record.data : [];
  if (rawData.length === 0) {
    return { ok: false, error: "Image editing returned no images.", status: response.status };
  }

  const images: ImagineImage[] = [];
  for (const item of rawData) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.b64_json === "string" && row.b64_json) {
      const built = dataUrlFromB64(row.b64_json, typeof row.mime_type === "string" ? row.mime_type : undefined);
      if (!built.ok) return { ok: false, error: built.error, status: response.status };
      images.push({ dataUrl: built.dataUrl, mime: built.mime });
      continue;
    }
    if (typeof row.url === "string" && row.url) {
      const downloaded = await downloadUrlToDataUrl(row.url, fetchImpl, options.lookup);
      if (!downloaded.ok) return { ok: false, error: downloaded.error, status: response.status };
      images.push({ dataUrl: downloaded.dataUrl, mime: downloaded.mime, sourceUrl: row.url });
    }
  }

  if (images.length === 0) {
    return { ok: false, error: "Image editing returned no usable image payloads.", status: response.status };
  }

  const resolvedModel = typeof record.model === "string" && record.model ? record.model : model;
  if (!options.skipSpendControls && options.meter?.ownerId) {
    getImagineSpendLedger().record({ ownerId: options.meter.ownerId, model: resolvedModel, n: images.length || 1 });
  }
  return {
    ok: true,
    model: resolvedModel,
    images,
    usage: record.usage,
  };
}

