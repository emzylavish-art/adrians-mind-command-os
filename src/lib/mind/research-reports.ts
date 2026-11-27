import type { ResearchCitation, ResearchResult } from "./research.ts";

export type ResearchClaim = { id: string; text: string; sourceUrls: string[]; kind: "direct-evidence" | "interpretation" | "hypothesis" | "provider-cited"; addedAt: string };
export type ResearchReportVersion = { version: number; summary: string; citations: ResearchCitation[]; steps?: ResearchResult["steps"]; at: string; claims?: ResearchClaim[] };
export type ResearchReport = ResearchReportVersion & { id: string; question: string; versions?: ResearchReportVersion[] };
export type ResearchReference = { reportId: string; version: number; question: string; at: string };
export const researchArchiveKey = (owner: string) => `amcos.research.v2.${owner}`;

/** References survive composer reload; only an exact version in this account's archive is linked. */
export function researchReferencesInText(text: string, reports: ResearchReport[]): ResearchReference[] {
  const references: ResearchReference[] = [];
  for (const match of text.matchAll(/Research reference ([A-Za-z0-9_-]{1,200}) · version (\d+)/g)) {
    const report = reports.find((row) => row.id === match[1]);
    const version = Number(match[2]);
    const saved = report?.version === version ? report : report?.versions?.find((row) => row.version === version);
    if (report && saved && !references.some((row) => row.reportId === report.id && row.version === version)) references.push({ reportId: report.id, version, question: report.question, at: saved.at });
  }
  return references;
}

function distinctSources(before: ResearchCitation[], after: ResearchCitation[]) {
  return [...new Map([...before, ...after].map((source) => [source.url, source])).values()];
}

/** Recovery adds evidence; a completion counter never replaces substantive findings. */
export function makeResearchReport(question: string, result: ResearchResult, previous?: ResearchReport, at = new Date().toISOString()): ResearchReport {
  const steps = previous?.steps ? previous.steps.map((step) => result.steps?.find((next) => next.query === step.query) ?? step) : result.steps;
  const additions = (result.steps ?? []).filter((step) => !steps?.some((current) => current.query === step.query));
  const allSteps = steps ? [...steps, ...additions] : undefined;
  const before = previous?.summary.trim() || "";
  const after = result.summary?.trim() || "";
  const summary = before && after && before !== after ? `${before}\n\nRecovered evidence:\n${after}` : before || after;
  const version = (previous?.version ?? (previous ? 1 : 0)) + 1;
  const citations = distinctSources(previous?.citations ?? [], result.citations.map((source) => ({ ...source, retrievedAt: source.retrievedAt || at, query: source.query || question, verification: source.verification || "search-result-only" })));
  const sourceUrls = new Set(citations.map((source) => source.url));
  const claims = [...(previous?.claims ?? [])];
  for (const claim of result.claims ?? []) {
    const urls = claim.sourceUrls.filter((url) => sourceUrls.has(url));
    if (urls.length && !claims.some((old) => old.text === claim.text && JSON.stringify(old.sourceUrls) === JSON.stringify(urls))) claims.push({ ...claim, sourceUrls: urls, id: crypto.randomUUID(), addedAt: at });
  }
  return { id: previous?.id || crypto.randomUUID(), question, summary, citations, steps: allSteps, at, version,
    claims, versions: previous ? [...(previous.versions ?? []), { version: previous.version || 1, summary: previous.summary, citations: previous.citations, steps: previous.steps, claims: previous.claims, at: previous.at }] : [] };
}

export function researchCoverage(report: Pick<ResearchReport, "steps">): string {
  return report.steps ? `${report.steps.filter((step) => step.ok).length} of ${report.steps.length} searches succeeded.` : "Search coverage was not reported.";
}

/** Local archive retains every report; callers may slice for the recent shortcut only. */
export function saveResearchReport(storage: Pick<Storage, "setItem">, owner: string, current: ResearchReport[], report: ResearchReport) {
  const history = [report, ...current.filter((item) => item.id !== report.id)];
  if (!owner) return { history, saved: false, error: "Sign in before saving research history." };
  try { storage.setItem(researchArchiveKey(owner), JSON.stringify(history)); return { history, saved: true, error: "" }; }
  catch { return { history, saved: false, error: "The new report is still visible, but this browser could not save the archive. Export it before leaving; older stored reports were not removed." }; }
}

export function loadResearchReports(storage: Pick<Storage, "getItem">, owner: string): ResearchReport[] {
  if (!owner) return [];
  try {
    const raw: unknown = JSON.parse(storage.getItem(researchArchiveKey(owner)) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.question !== "string" || typeof item.summary !== "string" || !Array.isArray(item.citations)) return [];
      return [{ ...item, version: Number.isSafeInteger(item.version) && item.version > 0 ? item.version : 1,
        citations: item.citations.filter((citation: ResearchCitation) => citation && typeof citation.title === "string" && typeof citation.url === "string" && /^https?:\/\//.test(citation.url)) } as ResearchReport];
    });
  } catch { return []; }
}

export function addResearchClaim(report: ResearchReport, input: { text: string; sourceUrls: string[]; kind: ResearchClaim["kind"] }): ResearchReport | null {
  const text = input.text.trim();
  if (!text || text.length > 4000) return null;
  const valid = new Set(report.citations.map((source) => source.url));
  const sourceUrls = [...new Set(input.sourceUrls)].filter((url) => valid.has(url));
  if (input.kind !== "hypothesis" && !sourceUrls.length) return null;
  return { ...report, claims: [...(report.claims ?? []), { id: crypto.randomUUID(), text, sourceUrls, kind: input.kind, addedAt: new Date().toISOString() }] };
}

/** Attach a stable version and a bounded evidence excerpt, never an invented source passage. */
export function researchAttachment(report: ResearchReport, question = "", budget = 3500): { reference: ResearchReference; text: string; omitted: boolean } {
  budget = Math.max(512, Math.min(8000, Math.floor(budget) || 3500));
  const reference = { reportId: report.id, version: report.version || 1, question: report.question, at: report.at };
  const terms = question.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const score = (text: string) => terms.filter((term) => text.toLowerCase().includes(term)).length;
  const sources = [...report.citations].sort((a, b) => score(`${b.title} ${b.excerpt || ""}`) - score(`${a.title} ${a.excerpt || ""}`));
  let text = `Research reference ${report.id} · version ${reference.version}\nQuestion: ${report.question.slice(0, 300)}\nRetrieved: ${report.at}\nEvidence is search-result metadata unless independently verified.\n`;
  const summary = report.summary.slice(0, Math.min(1500, Math.floor(budget / 2)));
  text += summary ? `Summary excerpt:\n${summary}\n` : "";
  let used = 0;
  for (const source of sources) {
    const line = `\nSource: ${source.title}\n${source.url}${source.excerpt ? `\nProvider excerpt: ${source.excerpt}` : "\nNo source passage was returned."}\n`;
    if (text.length + line.length > budget) continue;
    text += line; used++;
  }
  const omitted = summary.length < report.summary.length || used < sources.length;
  if (omitted) text = text.slice(0, Math.max(0, budget - 70)) + "\nCoverage is partial. Open the saved report for omitted evidence.";
  return { reference, text, omitted };
}

/** Canceling local presentation never asserts that a provider has stopped billing. */
export function createResearchRunGuard() {
  let generation = 0;
  return { begin: () => ++generation, current: (id: number) => id === generation, cancel: () => { generation++; return "Research display stopped. The provider request may still complete; no automatic retry was started."; } };
}
