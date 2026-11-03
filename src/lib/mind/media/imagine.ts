import { IMAGINE_MAX_N, checkImagineRateLimit, imagineRateLimitKey, mapImagineHttpError } from "./harden.ts";
import { getImagineSpendLedger, reserveImagineSpend } from "./spend-ledger.ts";
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
 * Whether a failed upstream attempt definitely did NOT bill. Only these refund a
 * reservation; anything ambiguous (timeouts after send, 5xx, bad 2xx bodies,
 * download/SSRF failures after a 200) keeps the charge.
 */
type Billing = "none" | "maybe";
type Attempt = { result: ImagineResult; billing: Billing; model?: string };

const NOT_SENT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ERR_INVALID_URL",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object" && typeof (cause as { code?: unknown }).code === "string") {
    return (cause as { code: string }).code;
  }
  return undefined;
}

export function fetchErrorDefinitelyNotSent(error: unknown): boolean {
  const code = errorCode(error);
  return code ? NOT_SENT_CODES.has(code) : false;
}

/** 4xx (incl. 429) = refused before generation. 408 is a timeout and stays ambiguous. */
export function upstreamStatusDefinitelyNotBilled(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408;
}

/** Run an attempt under a held reservation: settle on success/ambiguous, refund only when definitely unbilled. */
async function withReservation(reservationId: string | null, attempt: () => Promise<Attempt>): Promise<ImagineResult> {
  if (!reservationId) return (await attempt()).result;
  const ledger = getImagineSpendLedger();
  let outcome: Attempt;
  try {
    outcome = await attempt();
  } catch (error) {
    ledger.settle(reservationId); // unknown failure — keep the charge
    throw error;
  }
  if (!outcome.result.ok && outcome.billing === "none") ledger.refund(reservationId);
  else ledger.settle(reservationId, { model: outcome.model });
  return outcome.result;
}

/** Shared xAI POST + parse for generations/edits. */
async function callImagesEndpoint(
  label: { noun: string; endpointName: string },
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  fallbackModel: string,
  fetchImpl: FetchLike,
  lookup: LookupFn | undefined,
): Promise<Attempt> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      result: { ok: false, error: `Could not reach the xAI ${label.endpointName} endpoint.`, status: 502 },
      billing: fetchErrorDefinitelyNotSent(error) ? "none" : "maybe",
    };
  }
  const billingOnFail: Billing = upstreamStatusDefinitelyNotBilled(response.status) ? "none" : "maybe";

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return {
      result: {
        ok: false,
        error: `${label.noun} returned a non-JSON response (HTTP ${response.status}).`,
        status: response.status,
      },
      billing: billingOnFail,
    };
  }

  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  if (!response.ok) {
    const err = record.error;
    const raw =
      typeof err === "string"
        ? err
        : err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
          ? String((err as { message: string }).message)
          : `${label.noun} failed (HTTP ${response.status}).`;
    return { result: { ok: false, error: mapImagineHttpError(response.status, raw), status: response.status }, billing: billingOnFail };
  }

  // From here the upstream accepted (2xx) — any failure keeps the charge.
  const rawData = Array.isArray(record.data) ? record.data : [];
  if (rawData.length === 0) {
    return { result: { ok: false, error: `${label.noun} returned no images.`, status: response.status }, billing: "maybe" };
  }

  const images: ImagineImage[] = [];
  for (const item of rawData) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.b64_json === "string" && row.b64_json) {
      const built = dataUrlFromB64(row.b64_json, typeof row.mime_type === "string" ? row.mime_type : undefined);
      if (!built.ok) return { result: { ok: false, error: built.error, status: response.status }, billing: "maybe" };
      images.push({ dataUrl: built.dataUrl, mime: built.mime });
      continue;
    }
    if (typeof row.url === "string" && row.url) {
      const downloaded = await downloadUrlToDataUrl(row.url, fetchImpl, lookup);
      if (!downloaded.ok) return { result: { ok: false, error: downloaded.error, status: response.status }, billing: "maybe" };
      images.push({ dataUrl: downloaded.dataUrl, mime: downloaded.mime, sourceUrl: row.url });
    }
  }

  if (images.length === 0) {
    return {
      result: { ok: false, error: `${label.noun} returned no usable image payloads.`, status: response.status },
      billing: "maybe",
    };
  }

  const resolvedModel = typeof record.model === "string" && record.model ? record.model : fallbackModel;
  return {
    result: { ok: true, model: resolvedModel, images, usage: record.usage },
    billing: "maybe",
    model: resolvedModel,
  };
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

  let reservationId: string | null = null;
  if (!options.skipSpendControls) {
    const ownerId = options.meter?.ownerId?.trim() ?? "";
    if (!ownerId) {
      return { ok: false, error: "Imagine requires an owner id for spend controls.", status: 400 };
    }
    // Synchronous check + reserve — no await between the cap check and holding the slot.
    const reserved = reserveImagineSpend({
      ownerId,
      sessionId: options.meter?.sessionId,
      n,
      model,
      checkRateLimit: checkImagineRateLimit,
      rateLimitKey: imagineRateLimitKey,
    });
    if (!reserved.ok) return { ok: false, error: reserved.error, status: reserved.status };
    reservationId = reserved.reservationId;
  }

  return withReservation(reservationId, async () => {
    const apiKey = options.apiKey ?? resolveXaiInferenceApiKey();
    if (!apiKey) {
      return {
        result: { ok: false, error: "Image generation is not configured on the server.", status: 503 },
        billing: "none",
      };
    }
    const responseFormat = input.responseFormat ?? "b64_json";
    return callImagesEndpoint(
      { noun: "Image generation", endpointName: "image generation" },
      options.endpoint ?? XAI_IMAGES_GENERATIONS_URL,
      apiKey,
      { model, prompt: normalized.prompt, n, response_format: responseFormat },
      model,
      options.fetchImpl ?? fetch,
      options.lookup,
    );
  });
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

  const model = resolveImagineModel(input.model);
  let reservationId: string | null = null;
  if (!options.skipSpendControls) {
    const ownerId = options.meter?.ownerId?.trim() ?? "";
    if (!ownerId) {
      return { ok: false, error: "Imagine requires an owner id for spend controls.", status: 400 };
    }
    const reserved = reserveImagineSpend({
      ownerId,
      sessionId: options.meter?.sessionId,
      n: 1,
      model,
      checkRateLimit: checkImagineRateLimit,
      rateLimitKey: imagineRateLimitKey,
    });
    if (!reserved.ok) return { ok: false, error: reserved.error, status: reserved.status };
    reservationId = reserved.reservationId;
  }

  return withReservation(reservationId, async () => {
    const apiKey = options.apiKey ?? resolveXaiInferenceApiKey();
    if (!apiKey) {
      return {
        result: { ok: false, error: "Image editing is not configured on the server.", status: 503 },
        billing: "none",
      };
    }
    const responseFormat = input.responseFormat ?? "b64_json";
    const requestBody: Record<string, unknown> = {
      model,
      prompt: normalized.prompt,
      response_format: responseFormat,
    };
    if (imageUrls.length === 1) requestBody.image_url = imageUrls[0];
    else requestBody.image_urls = imageUrls;
    return callImagesEndpoint(
      { noun: "Image editing", endpointName: "image edits" },
      options.endpoint ?? XAI_IMAGES_EDITS_URL,
      apiKey,
      requestBody,
      model,
      options.fetchImpl ?? fetch,
      options.lookup,
    );
  });
}
