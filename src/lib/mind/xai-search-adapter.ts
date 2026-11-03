/**
 * Provider-neutral MIND_SEARCH transport backed by xAI Responses API web_search + x_search.
 * Speaks the same contract as a dedicated MIND_SEARCH_ENDPOINT:
 *   POST { query } → { results: [{ title, url }] }
 * Never invents URLs — only returns http(s) links present in the provider response.
 * Never logs API keys.
 */

import { resolveXaiInferenceApiKey, readXaiApiKey, XAI_INFERENCE_SECRETS_PATH, redactSecretsFromText } from "./xai-adapter.ts";
import { MAX_SEARCH_RESPONSE_BYTES, normalizeCitations } from "./research.ts";

export const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";
/** Opaque endpoint id used when falling back to this adapter (not a public HTTP service). */
export const XAI_MIND_SEARCH_ADAPTER_ENDPOINT = "mind://search-adapter/xai-responses";
export const XAI_MIND_SEARCH_ADAPTER_KEY = "mind-search-adapter";

const DEFAULT_SEARCH_MODEL = "grok-4-fast-non-reasoning";

export type MindSearchBackend =
  | { kind: "dedicated"; endpoint: string; key: string }
  | { kind: "xai-adapter"; endpoint: string; key: string; apiKey: string; model: string }
  | { kind: "none"; error: string };

/**
 * Prefer a dedicated MIND_SEARCH_* provider. Fall back to the xAI Responses adapter
 * when an inference key is available. Provider-neutral: callers always get endpoint+key
 * (+ optional fetchImpl) and never brand the UI as a single vendor.
 */
export function resolveMindSearchBackend(
  env: Record<string, string | undefined> = process.env,
  options: { secretsPath?: string; skipSecretsFile?: boolean } = {},
): MindSearchBackend {
  const endpoint = env.MIND_SEARCH_ENDPOINT?.trim() ?? "";
  const key = env.MIND_SEARCH_KEY?.trim() ?? "";
  if (endpoint && key) {
    return { kind: "dedicated", endpoint, key };
  }

  const keyed = options.skipSecretsFile
    ? readXaiApiKey(env)
    : resolveXaiInferenceApiKey(env, options.secretsPath ?? XAI_INFERENCE_SECRETS_PATH);

  if (keyed.ok) {
    const model =
      env.MIND_SEARCH_ADAPTER_MODEL?.trim() ||
      env.MIND_MODEL_FAST?.trim() ||
      DEFAULT_SEARCH_MODEL;
    return {
      kind: "xai-adapter",
      endpoint: XAI_MIND_SEARCH_ADAPTER_ENDPOINT,
      key: XAI_MIND_SEARCH_ADAPTER_KEY,
      apiKey: keyed.key,
      model,
    };
  }

  if (!endpoint && !key) {
    return {
      kind: "none",
      error: "No search provider is configured. Nothing was searched and no citations were created.",
    };
  }
  if (!endpoint) {
    return {
      kind: "none",
      error: "MIND_SEARCH_ENDPOINT is missing. Nothing was searched and no citations were created.",
    };
  }
  return {
    kind: "none",
    error: "MIND_SEARCH_KEY is missing. Nothing was searched and no citations were created.",
  };
}


/** Collect http(s) URLs from a Responses API payload (citations + annotations + output text). */
export function extractUrlsFromXaiResponse(payload: unknown): { title: string; url: string }[] {
  const found: { title: string; url: string }[] = [];
  const seen = new Set<string>();

  const push = (urlRaw: unknown, titleRaw?: unknown) => {
    if (typeof urlRaw !== "string") return;
    const url = urlRaw.trim();
    if (!url) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const title =
      typeof titleRaw === "string" && titleRaw.trim()
        ? titleRaw.trim().slice(0, 200)
        : url.replace(/^https?:\/\//i, "").slice(0, 200);
    found.push({ title, url });
  };

  const walk = (node: unknown, depth = 0) => {
    if (depth > 12 || node == null) return;
    if (typeof node === "string") {
      const matches = node.match(/https?:\/\/[^\s\]\)>"']+/gi) ?? [];
      for (const m of matches) push(m.replace(/[.,;:]+$/, ""));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (typeof rec.url === "string") push(rec.url, rec.title ?? rec.name);
    if (Array.isArray(rec.citations)) {
      for (const c of rec.citations) {
        if (typeof c === "string") push(c);
        else if (c && typeof c === "object") {
          const item = c as { url?: unknown; title?: unknown };
          push(item.url, item.title);
        }
      }
    }
    for (const [k, v] of Object.entries(rec)) {
      if (k === "citations") continue;
      walk(v, depth + 1);
    }
  };

  walk(payload);
  return normalizeCitations(found).map((c) => ({ title: c.title, url: c.url }));
}

export async function callXaiWebSearch(input: {
  query: string;
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  includeXSearch?: boolean;
}): Promise<{ ok: true; results: { title: string; url: string }[] } | { ok: false; status: number; error: string }> {
  const query = input.query.trim().slice(0, 300);
  if (!query) return { ok: false, status: 400, error: "Write what you want researched." };
  const fetchImpl = input.fetchImpl ?? fetch;
  const tools: { type: string }[] = [{ type: "web_search" }];
  if (input.includeXSearch !== false) tools.push({ type: "x_search" });

  let response: Response;
  try {
    response = await fetchImpl(XAI_RESPONSES_URL, {
      method: "POST",
      signal: input.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
        accept: "application/json",
      },
      body: JSON.stringify({
        model: input.model || DEFAULT_SEARCH_MODEL,
        input: [
          {
            role: "user",
            content: `Search the web and return factual sources for this research query. Prefer primary sources.\n\nQuery: ${query}`,
          },
        ],
        tools,
      }),
    });
  } catch (caught) {
    if (input.signal?.aborted) throw caught;
    return { ok: false, status: 0, error: "The search provider did not answer. No citations were created." };
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch (caught) {
    if (input.signal?.aborted) throw caught;
    return { ok: false, status: response.status, error: "The search provider returned an unreadable result. No citations were created." };
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_SEARCH_RESPONSE_BYTES) {
    return { ok: false, status: response.status, error: "The search provider returned a result that is too large. No citations were created." };
  }
  if (!response.ok) {
    const safe = redactSecretsFromText(`The search provider returned ${response.status}. No citations were created.`, [
      input.apiKey,
    ]);
    return { ok: false, status: response.status, error: safe };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, status: response.status, error: "The search provider returned an unreadable result. No citations were created." };
  }
  const results = extractUrlsFromXaiResponse(payload);
  return { ok: true, results };
}

/**
 * fetchImpl that satisfies performSearch's MIND_SEARCH contract by calling xAI Responses.
 * Only handles XAI_MIND_SEARCH_ADAPTER_ENDPOINT; other URLs fall through to global fetch.
 */
export function createXaiMindSearchFetch(options: {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  includeXSearch?: boolean;
}): typeof fetch {
  const inner = options.fetchImpl ?? fetch;
  const adapter: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== XAI_MIND_SEARCH_ADAPTER_ENDPOINT) {
      return inner(input as RequestInfo, init);
    }
    let query = "";
    try {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      query = typeof body.query === "string" ? body.query : "";
    } catch {
      query = "";
    }
    const result = await callXaiWebSearch({
      query,
      apiKey: options.apiKey,
      model: options.model,
      signal: init?.signal ?? undefined,
      fetchImpl: inner,
      includeXSearch: options.includeXSearch,
    });
    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error, results: [] }), {
        status: result.status >= 400 ? result.status : 502,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ results: result.results }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return adapter;
}
