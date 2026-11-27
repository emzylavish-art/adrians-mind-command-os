import assert from "node:assert/strict";
import { it } from "node:test";
import { addResearchClaim, createResearchRunGuard, loadResearchReports, makeResearchReport, researchAttachment, researchCoverage, researchReferencesInText, saveResearchReport } from "./research-reports.ts";
import { normalizeCitations } from "./research.ts";

const initial = () => makeResearchReport("Infrastructure", { ok: true, configured: true, error: "", summary: "Keep the original finding about storage.", citations: [{ title: "Official source", url: "https://example.com/a" }], steps: [{ query: "one", ok: true, count: 1 }, { query: "two", ok: false, count: 0 }] });

it("retry adds recovered findings without replacing prior summary and retains the older version", () => {
  const first = initial();
  const next = makeResearchReport(first.question, { ok: true, configured: true, error: "", summary: "New finding about deployments.", citations: [{ title: "Second source", url: "https://example.com/b" }], steps: [{ query: "two", ok: true, count: 1 }] }, first);
  assert.match(next.summary, /original finding/);
  assert.match(next.summary, /New finding/);
  assert.equal(next.id, first.id);
  assert.equal(next.versions?.[0].summary, first.summary);
  assert.equal(researchCoverage(next), "2 of 2 searches succeeded.");
  assert.equal(next.citations.length, 2);
});

it("all twenty reports survive archive reload, while failed saves keep previous storage", () => {
  const rows = new Map<string, string>();
  const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
  let history = [] as ReturnType<typeof initial>[];
  for (let i = 0; i < 20; i++) history = saveResearchReport(storage, "owner", history, initial()).history;
  assert.equal(loadResearchReports(storage, "owner").length, 20);
  assert.equal(loadResearchReports(storage, "other").length, 0);
  const failed = saveResearchReport({ setItem: () => { throw Error("quota"); } }, "owner", history, initial());
  assert.equal(failed.saved, false);
  assert.equal(failed.history.length, 21);
  assert.equal(loadResearchReports(storage, "owner").length, 20);
});

it("claim links only target known sources and hypotheses stay distinct", () => {
  const report = initial();
  assert.equal(addResearchClaim(report, { text: "Unsupported", sourceUrls: ["https://unknown.invalid"], kind: "direct-evidence" }), null);
  const next = addResearchClaim(report, { text: "A supported interpretation", sourceUrls: [report.citations[0].url], kind: "interpretation" })!;
  assert.equal(next.claims?.[0].sourceUrls[0], report.citations[0].url);
  assert.equal(next.claims?.[0].kind, "interpretation");
  assert.equal(addResearchClaim(next, { text: "Needs verification", sourceUrls: [], kind: "hypothesis" })?.claims?.length, 2);
});

it("source freshness comes from observed retrieval and provider metadata without page verification claims", () => {
  const rows = normalizeCitations([{ title: "Report", url: "https://example.com/a", snippet: "Actual returned passage", publishedAt: "2026-01-01" }], { query: "query", retrievedAt: "2026-11-25T00:00:00Z" });
  assert.equal(rows[0].verification, "search-result-only");
  assert.equal(rows[0].excerpt, "Actual returned passage");
  assert.equal(rows[0].publishedAt, "2026-01-01");
});

it("follow-ups carry stable version references and bounded evidence; canceled runs cannot commit", () => {
  const report = initial(); report.summary = "long finding ".repeat(2000);
  const attached = researchAttachment(report, "storage", 3500);
  assert.equal(attached.reference.reportId, report.id);
  assert.equal(attached.reference.version, 1);
  assert.equal(attached.omitted, true);
  assert.ok(attached.text.length < 3600);
  const guard = createResearchRunGuard(); const first = guard.begin();
  assert.equal(guard.current(first), true);
  assert.match(guard.cancel(), /provider request may still complete/);
  assert.equal(guard.current(first), false);
  const second = guard.begin(); assert.equal(guard.current(second), true);
});

it("follow-up references keep the attached version even after the report is revised", () => {
  const first = initial();
  const attached = researchAttachment(first);
  const revised = makeResearchReport(first.question, { ok: true, configured: true, error: "", summary: "New result", citations: [], steps: [] }, first);
  assert.equal(revised.version, 2);
  const references = researchReferencesInText(attached.text, [revised]);
  assert.equal(references[0]?.reportId, first.id);
  assert.equal(references[0]?.version, 1);
  assert.equal(researchReferencesInText("Research reference unrelated · version 1", [revised]).length, 0);
});
