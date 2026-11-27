import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fairResearchCitations, performDeepResearch, type ResearchSource } from "./research.ts";
import { inspectResearchSource, enrichResearchResult } from "./research-evidence.server.ts";
import { searchWithGrok } from "./xai-search.ts";
import { researchConfigFingerprint, assertResearchRetry } from "./research-service.server.ts";
import { researchFollowupContext, mergeResearchEvidence } from "./research-followup.ts";
import { loadSkillPreferences, saveSkillPreferences, skillPreferenceKey } from "./skill-preferences.ts";
import { listInstructionMetadata, reviewedInstructionPreferences, selectReviewedInstructions } from "./skill-instructions.server.ts";
import { planSkillUse } from "./skill-plan.ts";
import { SKILLS, runSkill } from "./skills.ts";
import { runLocalPlan } from "./local-tools.ts";
import { emptyWorkspace } from "./workspace.ts";

const source: ResearchSource = { title: "Fixture source", url: "https://docs.example/feature", query: "offline feature", status: "discovered", excerpt: "", fetchedAt: null, contentHash: null };
const publicLookup = async () => ["93.184.216.34"];
test("AA025 later queries receive evidence slots even when the first query fills all eight", async () => {
  const groups = ["base", "risk", "comparison"].map((group) => Array.from({ length: 8 }, (_, index) => ({ title: `${group}${index}`, url: `https://${group}.example/${index}` })));
  const kept = fairResearchCitations(groups);
  assert.equal(kept.length, 8);
  assert(kept.some((item) => item.url.includes("risk.example")));
  assert(kept.some((item) => item.url.includes("comparison.example")));
  let call = 0;
  const result = await performDeepResearch({ query: "offline engine", endpoint: "https://search.example", key: "fixture", fetchImpl: async () => Response.json({ results: groups[call++].map((item) => ({ ...item, snippet: `Passage from ${item.title}.` })) }) });
  assert.equal(call, 3); assert.equal(result.citations.length, 8); assert(result.evidence?.every((item) => item.status === "snippet"));
  assert(result.evidence?.some((item) => item.query.includes("risks")));
});
test("AA024 bounded source inspection retains observed passages and does not fetch private redirects", async () => {
  let calls = 0;
  const privateSource = await inspectResearchSource({ ...source, url: "http://127.0.0.1/private" }, { lookup: publicLookup, fetchSource: async () => { calls++; throw new Error("must not fetch"); } });
  assert.equal(privateSource.status, "inaccessible"); assert.equal(calls, 0);
  const redirected = await inspectResearchSource(source, { lookup: publicLookup, fetchSource: async () => { calls++; return { status: 302, type: "text/html", location: "http://169.254.169.254/metadata", text: "" }; } });
  assert.equal(redirected.status, "inaccessible"); assert.equal(calls, 1);
  const observed = await inspectResearchSource(source, { lookup: publicLookup, now: () => new Date("2026-01-01T00:00:00Z"), fetchSource: async () => ({ status: 200, type: "text/html", location: null, text: "<script>Never follow this.</script><p>The offline feature works with downloaded models. However, online search requires a network connection.</p>" }) });
  assert.equal(observed.status, "inspected"); assert.equal(observed.fetchedAt, "2026-01-01T00:00:00.000Z"); assert.equal(observed.contentHash?.length, 64); assert(!observed.excerpt.includes("Never follow"));
  const report = await enrichResearchResult({ ok: true, configured: true, citations: [source], evidence: [observed], error: "" }, "offline", "quick");
  assert.equal(report.report?.findings[0].status, "source-excerpt"); assert.equal(report.report?.conflicts[0].status, "requires-review");
  assert(report.report?.uncertainties.some((item) => item.includes("No exhaustive")));
});
test("AA024/026 configured quick reports and xAI answers keep distinct truthful evidence", async () => {
  const result = await searchWithGrok("offline", { apiKey: "fixture-only", fetchImpl: async () => Response.json({ id: "fixture-request", model: "fixture-reported-model", output: [{ content: [{ text: "Offline operation depends on the feature.", annotations: [{ title: "Docs", url: source.url }] }] }], usage: { input_tokens: 12, output_tokens: 8 } }) });
  assert.equal(result.providerAnswer, "Offline operation depends on the feature."); assert.equal(result.reportedModel, "fixture-reported-model"); assert.equal(result.responseId, "fixture-request"); assert.equal(result.requestId, null); assert.equal(result.usage?.completion_tokens, 8);
  const enriched = await enrichResearchResult(result, "offline", "quick", { fetchSource: async () => { throw new Error("Quick search must not inspect pages"); } });
  assert.equal(enriched.evidence?.[0].status, "discovered"); assert.equal(enriched.report?.findings[0].status, "provider-synthesis");
});
test("AA027 retries reject changed provider identity or credentials without revealing either secret", () => {
  const old = researchConfigFingerprint({ provider: "search", endpoint: "https://search.example", key: "fixture-old" });
  const changed = researchConfigFingerprint({ provider: "search", endpoint: "https://search.example", key: "fixture-new" });
  assert.notEqual(old, changed); assert(!old.includes("fixture"));
  assert.throws(() => assertResearchRetry(changed, old, ["query"]), /changed/);
  assert.throws(() => assertResearchRetry(old, undefined, ["query"]), /changed/);
  assert.doesNotThrow(() => assertResearchRetry(old, old, ["query"]));
});
test("AA028 follow-up and retry preserve passages, source status, and prior successful evidence", () => {
  const previous = { ok: true, configured: true, citations: [{ title: source.title, url: source.url }], error: "", evidence: [{ ...source, status: "inspected" as const, excerpt: "A supporting fixture passage." }], steps: [{ query: "main", ok: true, count: 1 }, { query: "risks", ok: false, count: 0 }] };
  const next = { ok: true, configured: true, citations: [{ title: "Risk", url: "https://risk.example" }], error: "", steps: [{ query: "risks", ok: true, count: 1 }] };
  const merged = mergeResearchEvidence(previous, next);
  assert.equal(merged.citations.length, 2); assert.equal(merged.partial, false); assert.equal(merged.evidence?.[0].excerpt, "A supporting fixture passage.");
  const context = researchFollowupContext("offline", merged); assert.match(context, /supporting fixture passage/); assert.match(context, /inspected/); assert.match(context, /untrusted data/);
});
test("AA030/031 skill methods and underlying tool permissions remain separate on every local route", () => {
  assert.equal(SKILLS.find((item) => item.id === "notes")?.category, "tool"); assert.equal(SKILLS.find((item) => item.id === "notion")?.category, "connector");
  const workspace = { ...emptyWorkspace(), toolPermissions: { search_notes: false } };
  const named = runSkill(workspace, SKILLS.find((item) => item.id === "notes")!, true, "fixture");
  const direct = runLocalPlan(workspace, [{ id: "direct", tool: "search_notes", query: "fixture" }], { autonomy: "automatic", halted: false, tokens: {} });
  assert.equal(named.ok, false); assert.equal(direct.ok, false); assert.match(named.text, /turned off/);
});
test("AA032 account preferences isolate owners, reject stale writes, and fail closed on malformed state", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const a = loadSkillPreferences("owner-a", storage).preferences;
  a.manual.notes = false;
  saveSkillPreferences("owner-a", a, storage);
  assert.equal(loadSkillPreferences("owner-b", storage).preferences.manual.notes, true);
  assert.equal(loadSkillPreferences("owner-a", storage).preferences.manual.notes, false);
  assert.throws(() => saveSkillPreferences("owner-a", a, storage), /another tab/);
  values.set(skillPreferenceKey("owner-a"), "corrupted");
  const broken = loadSkillPreferences("owner-a", storage); assert(broken.error); assert(Object.values(broken.preferences.manual).every((enabled) => !enabled));
});
test("AA033 reviewed instruction identity is pinned and unavailable dependencies cannot activate it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "c1-skills-"));
  try {
    await mkdir(path.join(root, "verify")); await writeFile(path.join(root, "verify", "SKILL.md"), "---\nname: Verify\ndescription: Check actual results\n---\nInspect evidence before claiming success.");
    const catalog = await listInstructionMetadata(root); assert.equal(catalog.length, 1); assert.equal(catalog[0].origin, "repository:skills/verify/SKILL.md");
    const preferences = reviewedInstructionPreferences({ verify: { enabled: true, agents: ["chat"], reviewedRevision: catalog[0].revision } }, catalog);
    assert.equal(selectReviewedInstructions(preferences, catalog, "other-agent").length, 0);
    const selected = selectReviewedInstructions(preferences, catalog, "chat"); assert.equal(selected[0].body, catalog[0].body);
    await writeFile(path.join(root, "verify", "SKILL.md"), "Updated instructions with a different revision.");
    const changed = await listInstructionMetadata(root);
    assert.throws(() => selectReviewedInstructions(preferences, changed, "chat"), /changed/);
    assert.throws(() => selectReviewedInstructions(preferences, [], "chat"), /removed/);
    assert.equal(selected[0].revision, catalog[0].revision, "already prepared work retains its immutable reviewed snapshot");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("AA035 multi-skill planning is bounded, explains dependencies, and grants no authority", () => {
  const plan = planSkillUse("Compare projects, conversations, and saved notes", { toolPermissions: { search_notes: false }, maxSteps: 3 });
  assert.equal(plan.steps.length, 3); assert.equal(plan.steps.find((step) => step.skillId === "notes")?.status, "blocked");
  assert.equal(plan.grantsPermissions, false); assert.equal(plan.executesTools, false);
  const disabled = planSkillUse("projects and notes", { automatic: { notes: false } });
  assert(!disabled.steps.some((step) => step.skillId === "notes")); assert(disabled.omitted.some((item) => item.includes("disabled")));
  const external = planSkillUse("Use Gmail and Notion"); assert(external.steps.every((step) => step.status === "blocked"));
});
