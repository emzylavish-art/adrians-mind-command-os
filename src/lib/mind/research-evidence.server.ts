import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { resolveAndPinMcpHostname, type DnsLookupFn } from "./mcp/http-dns-pin.ts";
import type { ResearchDepth, ResearchEvidenceReport, ResearchResult, ResearchSource } from "./research.ts";

const MAX_SOURCE_BYTES = 128_000;
type SourceResponse = { status: number; type: string; location: string | null; text: string };
export type SourceFetcher = (url: URL, address: string, signal: AbortSignal) => Promise<SourceResponse>;

/** No cookies, provider credentials, or automatic redirects are forwarded to source sites. */
const pinnedSourceFetch: SourceFetcher = (url, address, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new Error("Source inspection stopped.")); return; }
  const client = url.protocol === "https:" ? https : http;
  const request = client.request({
    protocol: url.protocol, hostname: address, servername: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: `${url.pathname}${url.search}`, method: "GET",
    headers: { Host: url.host, Accept: "text/html,text/plain;q=0.9", "User-Agent": "AdrianMindResearch/1.0" },
  }, (response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (part: Buffer) => {
      size += part.length;
      if (size > MAX_SOURCE_BYTES) { request.destroy(new Error("Source exceeds the inspection size limit.")); return; }
      chunks.push(part);
    });
    response.on("error", reject);
    response.on("end", () => resolve({ status: response.statusCode ?? 0, type: String(response.headers["content-type"] ?? ""), location: typeof response.headers.location === "string" ? response.headers.location : null, text: Buffer.concat(chunks).toString("utf8") }));
  });
  const abort = () => request.destroy(new Error("Source inspection stopped."));
  signal.addEventListener("abort", abort, { once: true });
  request.on("error", reject);
  request.on("close", () => signal.removeEventListener("abort", abort));
  request.end();
});

export function sourcePassage(html: string, query: string): string {
  const plain = html.replace(/<(script|style|noscript|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi, (s) => ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[s.toLowerCase()] ?? " ")
    .replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].slice(0, 20);
  const sentences = plain.match(/[^.!?]+[.!?]?/g) ?? [plain];
  const ranked = sentences.map((text, index) => ({ text: text.trim(), index, score: terms.filter((term) => text.toLowerCase().includes(term)).length }))
    .filter((item) => item.text.length >= 35).sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.slice(0, 2).sort((a, b) => a.index - b.index).map((item) => item.text).join(" ").slice(0, 900);
}

export async function inspectResearchSource(source: ResearchSource, options: {
  signal?: AbortSignal; fetchSource?: SourceFetcher; lookup?: DnsLookupFn; now?: () => Date;
} = {}): Promise<ResearchSource> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(6_000)]) : AbortSignal.timeout(6_000);
  try {
    let url = new URL(source.url);
    for (let redirects = 0; redirects <= 2; redirects++) {
      if (signal.aborted) throw new Error("Source inspection stopped.");
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new Error("Source URL is not a public web page.");
      const pin = await resolveAndPinMcpHostname(url.hostname, options.lookup);
      if (!pin.ok) throw new Error("Source address is not publicly accessible.");
      const response = await (options.fetchSource ?? pinnedSourceFetch)(url, pin.pinnedAddress, signal);
      if ([301, 302, 303, 307, 308].includes(response.status) && response.location) { url = new URL(response.location, url); continue; }
      if (response.status < 200 || response.status >= 300) throw new Error(`Source returned HTTP ${response.status}.`);
      if (!/^text\/(?:html|plain)\b/i.test(response.type)) throw new Error("This source format cannot be inspected.");
      if (Buffer.byteLength(response.text) > MAX_SOURCE_BYTES) throw new Error("Source exceeds the inspection size limit.");
      const excerpt = sourcePassage(response.text, source.query);
      if (excerpt.length < 35) throw new Error("No readable supporting passage was found.");
      return { ...source, status: "inspected", excerpt, fetchedAt: (options.now?.() ?? new Date()).toISOString(), contentHash: createHash("sha256").update(response.text).digest("hex"), finalUrl: url.href, error: undefined };
    }
    throw new Error("Source redirected too many times.");
  } catch (error) {
    return { ...source, status: "inaccessible", error: error instanceof Error ? error.message : "Source inspection failed.", fetchedAt: null, contentHash: null };
  }
}

/** Extractive report: evidence and unresolved conflicts remain explicit; no model verification is invented. */
export function buildEvidenceReport(result: ResearchResult, depth: ResearchDepth, createdAt = new Date().toISOString()): ResearchEvidenceReport {
  const evidence = result.evidence ?? [];
  const inspected = evidence.filter((item) => item.status === "inspected");
  const findings: ResearchEvidenceReport["findings"] = inspected.map((source) => ({ text: source.excerpt, sourceUrls: [source.url], status: "source-excerpt" }));
  if (result.providerAnswer) findings.push({ text: result.providerAnswer, sourceUrls: result.citations.map((citation) => citation.url), status: "provider-synthesis" });
  const conflicts: ResearchEvidenceReport["conflicts"] = inspected.filter((source) => /\b(?:however|contrary|disput|inconsistent|conflict|limitation|not supported)\w*/i.test(source.excerpt))
    .map((source) => ({ text: source.excerpt, sourceUrls: [source.url], status: "requires-review" }));
  const steps = result.steps ?? [{ query: "", ok: result.ok, count: result.citations.length, status: "succeeded" as const }];
  const domains = new Set(evidence.map((source) => { try { return new URL(source.finalUrl ?? source.url).hostname.replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean));
  return {
    version: 1, depth, createdAt, findings, conflicts, sourceDomains: domains.size,
    attemptedQueries: steps.filter((step) => step.status !== "unattempted").length,
    unattemptedQueries: steps.filter((step) => step.status === "unattempted").length,
    uncertainties: [
      ...(evidence.some((source) => source.status !== "inspected") ? ["Some sources are discovered links, search snippets, or inaccessible pages; their claims are not verified."] : []),
      ...(result.providerAnswer ? ["Provider synthesis is preserved with its attribution; source support has not been independently verified claim by claim."] : []),
      ...(conflicts.length ? ["Qualifying or conflicting passages require review; matching wording is not proof that two sources contradict each other."] : []),
      "Different domains do not establish independent evidence. No exhaustive contradiction assessment or factual verification is claimed.",
      ...steps.filter((step) => !step.ok).map((step) => `${step.status === "unattempted" ? "Not attempted" : "Unresolved search"}: ${step.query}`),
    ],
  };
}

export async function enrichResearchResult(result: ResearchResult, query: string, depth: ResearchDepth, options: Parameters<typeof inspectResearchSource>[1] = {}): Promise<ResearchResult> {
  const evidence: ResearchSource[] = result.citations.map((citation) => result.evidence?.find((item) => item.url === citation.url) ?? { ...citation, query, status: "discovered", excerpt: "", fetchedAt: null, contentHash: null });
  if (depth !== "quick") {
    const signal = options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
    const max = depth === "deep" ? 8 : 4;
    // Two simultaneous public-page reads, at most eight pages, each with a bounded body and deadline.
    for (let offset = 0; offset < Math.min(max, evidence.length) && !signal.aborted; offset += 2) {
      const inspected = await Promise.all(evidence.slice(offset, Math.min(offset + 2, max)).map((source) => inspectResearchSource(source, { ...options, signal })));
      evidence.splice(offset, inspected.length, ...inspected);
    }
  }
  const displayedUrls = new Set(evidence.map(item => item.url));
  evidence.push(...(result.evidence ?? []).filter(item => !displayedUrls.has(item.url)));
  const enriched = { ...result, evidence };
  return { ...enriched, report: buildEvidenceReport(enriched, depth) };
}
