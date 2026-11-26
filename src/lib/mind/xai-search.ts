import { resolveXaiInferenceApiKey } from "./media/xai-key.ts";
import { normalizeCitations, type ResearchCitation, type ResearchResult } from "./research.ts";

const RESPONSES_URL = "https://api.x.ai/v1/responses";
export const SEARCH_MODEL = "grok-4.7";

function publicError(value: string): string {
  return value.replace(/xai-[A-Za-z0-9_-]+/g, "[key]").replace(/\s+/g, " ").trim().slice(0, 240);
}

function titleFor(url: string, raw: unknown): string {
  const title = typeof raw === "string" ? raw.trim() : "";
  if (title && !/^https?:/i.test(title) && !/^\d+$/.test(title) && title.length > 2) return title.slice(0, 200);
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/$/, "") : "";
    return `${host}${path}`.slice(0, 80);
  } catch {
    return "Source";
  }
}

function preferDirect(citations: ResearchCitation[]): ResearchCitation[] {
  const direct = citations.filter((item) => {
    try {
      const host = new URL(item.url).hostname;
      return host !== "t.co" && host !== "r.jina.ai" && !host.endsWith(".jina.ai");
    } catch {
      return false;
    }
  });
  return direct.length ? direct : citations;
}

function collectHits(body: unknown): { title: string; url: string }[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const hits: { title: string; url: string }[] = [];
  if (Array.isArray(record.citations)) {
    for (const item of record.citations) {
      if (typeof item === "string") hits.push({ title: titleFor(item, ""), url: item });
      else if (item && typeof item === "object") {
        const row = item as { url?: unknown; title?: unknown };
        if (typeof row.url === "string") hits.push({ title: titleFor(row.url, row.title), url: row.url });
      }
    }
  }
  const output = Array.isArray(record.output) ? record.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const annotations = (block as { annotations?: unknown }).annotations;
      if (!Array.isArray(annotations)) continue;
      for (const annotation of annotations) {
        if (!annotation || typeof annotation !== "object") continue;
        const row = annotation as { url?: unknown; title?: unknown };
        if (typeof row.url === "string") hits.push({ title: titleFor(row.url, row.title), url: row.url });
      }
    }
  }
  return hits;
}

/** Retain only explicit annotated spans; a bibliography alone does not prove claim support. */
export function researchEvidenceFromResponse(body: unknown, citations: ResearchCitation[]): { summary: string; claims: NonNullable<ResearchResult["claims"]> } {
  if (!body || typeof body !== "object") return { summary: "", claims: [] };
  const record = body as { output_text?: unknown; output?: unknown };
  const blocks: { text: string; annotations?: unknown[] }[] = [];
  for (const output of Array.isArray(record.output) ? record.output : []) {
    if (!output || typeof output !== "object" || !Array.isArray(output.content)) continue;
    for (const block of output.content) if (block && typeof block.text === "string") blocks.push({ text: block.text, annotations: Array.isArray(block.annotations) ? block.annotations : [] });
  }
  const summary = typeof record.output_text === "string" ? record.output_text : blocks.map((block) => block.text).join("\n");
  const known = new Set(citations.map((source) => source.url));
  const claims: NonNullable<ResearchResult["claims"]> = [];
  for (const block of blocks) {
    for (const raw of block.annotations ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const annotation = raw as { url?: unknown; start_index?: unknown; end_index?: unknown };
      const start = annotation.start_index, end = annotation.end_index;
      if (typeof annotation.url !== "string" || !known.has(annotation.url) || typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > block.text.length || end <= start) continue;
      const text = block.text.slice(start, end).trim();
      if (text) claims.push({ text, sourceUrls: [annotation.url], kind: "provider-cited" });
    }
  }
  return { summary, claims };
}

export async function searchWithGrok(
  query: string,
  options: { fetchImpl?: typeof fetch; apiKey?: string; beforeDispatch?: () => Promise<string | null> } = {},
): Promise<ResearchResult> {
  const text = query.trim();
  if (!text) return { ok: false, configured: false, citations: [], error: "Write what you want researched." };
  const apiKey = options.apiKey ?? resolveXaiInferenceApiKey();
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      citations: [],
      error: "No search provider is configured. Nothing was searched and no citations were created.",
    };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const blocked = await options.beforeDispatch?.();
  if (blocked) return { ok: false, configured: true, citations: [], error: blocked };
  let response: Response;
  try {
    response = await fetchImpl(RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: SEARCH_MODEL,
        input: [{ role: "user", content: text }],
        tools: [{ type: "web_search" }],
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return { ok: false, configured: true, citations: [], error: "The search provider did not answer. No citations were created." };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, configured: true, citations: [], error: "The search provider returned an unreadable result. No citations were created." };
  }
  if (!response.ok) {
    const record = body && typeof body === "object" ? (body as { error?: { message?: unknown } | string }) : {};
    const raw = typeof record.error === "string" ? record.error : typeof record.error?.message === "string" ? record.error.message : "";
    return {
      ok: false,
      configured: true,
      citations: [],
      error: publicError(raw || `The search provider returned ${response.status}. No citations were created.`),
    };
  }
  const citations: ResearchCitation[] = preferDirect(normalizeCitations(collectHits(body), { query: text, retrievedAt: new Date().toISOString() }));
  if (!citations.length) {
    return { ok: false, configured: true, citations: [], error: "The search returned no usable sources. No citations were created." };
  }
  return { ok: true, configured: true, citations, ...researchEvidenceFromResponse(body, citations), error: "" };
}
