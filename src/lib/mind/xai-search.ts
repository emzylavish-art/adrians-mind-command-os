import { resolveXaiInferenceApiKey } from "./media/xai-key.ts";
import { normalizeCitations, researchSnippets, type ResearchCitation, type ResearchResult, type ResearchAnswer } from "./research.ts";

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


// xAI uses Python character indices. Convert Unicode code points to JS string offsets.
function textOffsets(text: string): number[] {
  const offsets = [0];
  let offset = 0;
  for (const character of text) {
    offset += character.length;
    offsets.push(offset);
  }
  return offsets;
}

/** Preserve provider text and annotation offsets as attributed, unverified evidence. */
export function extractResearchAnswer(body: unknown): ResearchAnswer {
  if (!body || typeof body !== "object") return { text: "", annotations: [] };
  const output = (body as { output?: unknown }).output;
  const chunks: string[] = [];
  const annotations: ResearchAnswer["annotations"] = [];
  let offset = 0;
  for (const item of Array.isArray(output) ? output : []) {
    const content = item && typeof item === "object" ? (item as { content?: unknown }).content : undefined;
    for (const block of Array.isArray(content) ? content : []) {
      if (!block || typeof block !== "object") continue;
      const row = block as { text?: unknown; annotations?: unknown };
      if (typeof row.text !== "string" || !row.text) continue;
      const text = row.text.slice(0, Math.max(0, 16000 - offset));
      if (!text) break;
      const offsets = textOffsets(text);
      for (const annotation of Array.isArray(row.annotations) ? row.annotations : []) {
        if (!annotation || typeof annotation !== "object") continue;
        const a = annotation as { url?: unknown; start_index?: unknown; end_index?: unknown };
        const normalized = normalizeCitations([{ title: "Source", url: a.url }])[0];
        if (!normalized) continue;
        const start = typeof a.start_index === "number" && Number.isInteger(a.start_index) && a.start_index >= 0 && a.start_index < offsets.length ? a.start_index : null;
        const end = start !== null && typeof a.end_index === "number" && Number.isInteger(a.end_index) && a.end_index >= start && a.end_index < offsets.length ? a.end_index : null;
        annotations.push({ url: normalized.url, start: start === null || end === null ? null : offsets[start]! + offset, end: end === null ? null : offsets[end]! + offset });
      }
      chunks.push(text);
      offset += text.length + 2;
    }
  }
  return { text: chunks.join("\n\n"), annotations: annotations.slice(0, 80) };
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
    const offsets = textOffsets(block.text);
    for (const raw of block.annotations ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const annotation = raw as { url?: unknown; start_index?: unknown; end_index?: unknown };
      const start = annotation.start_index, end = annotation.end_index;
      const url = normalizeCitations([{ title: "Source", url: annotation.url }])[0]?.url;
      if (!url || !known.has(url) || typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= offsets.length || end <= start) continue;
      const text = block.text.slice(offsets[start], offsets[end]).trim();
      // Provider annotations can cover only the inline reference, rather than the statement.
      if (!text || /^\[.*?\](?:\([^)]*\))?$/.test(text)) continue;
      claims.push({ text, sourceUrls: [url], kind: "provider-cited" });
    }
  }
  return { summary, claims };
}

export async function searchWithGrok(
  query: string,
  options: { fetchImpl?: typeof fetch; apiKey?: string; signal?: AbortSignal; beforeDispatch?: () => Promise<string | null> } = {},
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
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
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
  const annotatedAnswer = extractResearchAnswer(body);
  const evidence = researchEvidenceFromResponse(body, citations);
  const record = body as Record<string, unknown>;
  const rawUsage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : {};
  const token = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  const usage = { prompt_tokens: token(rawUsage.input_tokens ?? rawUsage.prompt_tokens), completion_tokens: token(rawUsage.output_tokens ?? rawUsage.completion_tokens) };
  return { ok: true, configured: true, citations, ...evidence, evidence: researchSnippets([], text, citations),
    steps: [{ query: text, ok: true, count: citations.length, status: "succeeded" }],
    reportedModel: typeof record.model === "string" ? record.model.slice(0, 160) : null,
    usage: usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined ? usage : null, providerAnswer: annotatedAnswer.text || evidence.summary,
    annotatedAnswer, requestId: response.headers.get("x-request-id"), responseId: typeof record.id === "string" ? record.id.slice(0, 200) : null, error: "" };
}
