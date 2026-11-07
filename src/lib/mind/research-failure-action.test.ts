import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HONEST_FAILURE_MESSAGES, classifyHonestFailure, shouldShowFailureBanner } from "./failure-states.ts";
import { SEARCH_TIMEOUT_REPLY, type ResearchResult } from "./research.ts";
import {
  ResearchFailureBanner,
  ResearchPartialWarningBanner,
  classifyResearchFailureMessage,
  researchFailureFromCatch,
  researchFailureFromResult,
  researchFailureMessage,
  researchFailureMountHint,
  snapshotResearchFailureParams,
} from "./research-failure-action.ts";

function failed(error: string, configured = true): ResearchResult {
  return { ok: false, configured, citations: [], error };
}

describe("H32 research-layer failure mapping", () => {
  it("maps SEARCH_TIMEOUT_REPLY to research_failed with banner", () => {
    assert.equal(classifyHonestFailure(SEARCH_TIMEOUT_REPLY), "research_failed");
    assert.equal(classifyResearchFailureMessage(SEARCH_TIMEOUT_REPLY), "research_failed");
    assert.equal(shouldShowFailureBanner(SEARCH_TIMEOUT_REPLY), true);
    const outcome = researchFailureFromResult(failed(SEARCH_TIMEOUT_REPLY), {
      query: "harbor dredge",
      surface: "research_page",
    });
    assert.equal(outcome.tone, "failure");
    if (outcome.tone !== "failure") return;
    assert.equal(outcome.failure.kind, "research_failed");
    assert.equal(outcome.failure.message, SEARCH_TIMEOUT_REPLY);
    assert.equal(outcome.failure.auditAction, "research_failed");
    assert.equal(outcome.failure.target, "search");
    assert.deepEqual(outcome.failure.params, { query: "harbor dredge", surface: "research_page" });
  });

  it("maps not-configured copy without inventing sources", () => {
    const msg = HONEST_FAILURE_MESSAGES.research_not_configured;
    assert.equal(classifyHonestFailure(msg), "research_failed");
    const outcome = researchFailureFromResult(failed(msg, false), { query: "x", surface: "chat" });
    assert.equal(outcome.tone, "failure");
    if (outcome.tone !== "failure") return;
    assert.equal(outcome.failure.message, msg);
    assert.doesNotMatch(outcome.failure.message, /\d+\s+sources?\s+found/i);
    assert.match(outcome.failure.message, /No citations were created|Nothing was searched/);
  });

  it("maps MIND_SEARCH_* missing and provider HTTP including 429 rate limit", () => {
    assert.equal(
      classifyHonestFailure("MIND_SEARCH_ENDPOINT is missing. Nothing was searched and no citations were created."),
      "research_failed",
    );
    assert.equal(
      classifyHonestFailure("The search provider returned 502. No citations were created."),
      "research_failed",
    );
    // 429 wins rate_limited (existing classifier priority)
    assert.equal(
      classifyHonestFailure("The search provider returned 429. No citations were created."),
      "rate_limited",
    );
    const rate = researchFailureFromResult(
      failed("The search provider returned 429. No citations were created."),
      { query: "q", surface: "research_page" },
    );
    assert.equal(rate.tone, "failure");
    if (rate.tone !== "failure") return;
    assert.equal(rate.failure.kind, "rate_limited");
    assert.equal(rate.failure.auditAction, "rate_limited");
  });

  it("partial deep → warning tone, citations still shown, not a red failure", () => {
    const citations = [{ title: "Harbor notes", url: "https://example.com/a" }];
    const result: ResearchResult = {
      ok: true,
      configured: true,
      citations,
      error: "",
      partial: true,
      summary: "Deep research used 3 searches and kept 1 http(s) sources the provider returned:\n1. Harbor notes — https://example.com/a\nNote: some searches timed out; only confirmed sources are listed.",
    };
    const outcome = researchFailureFromResult(result, { query: "deep research harbor", surface: "research_page" });
    assert.equal(outcome.tone, "partial");
    if (outcome.tone !== "partial") return;
    assert.equal(outcome.warning.message, HONEST_FAILURE_MESSAGES.research_partial);
    assert.deepEqual(outcome.warning.citations, citations);
    assert.match(outcome.warning.summary, /Harbor notes/);
    assert.equal(classifyHonestFailure(outcome.warning.message), null);
    assert.equal(shouldShowFailureBanner(outcome.warning.message), false); // warning tone — not red failure
  });

  it("ok without partial is success; empty query is not a red failure", () => {
    const ok = researchFailureFromResult(
      { ok: true, configured: true, citations: [{ title: "A", url: "https://example.com/a" }], error: "" },
      { query: "a", surface: "chat" },
    );
    assert.equal(ok.tone, "ok");
    const empty = researchFailureFromResult(failed("Write what you want researched.", false), {
      query: "",
      surface: "research_page",
    });
    assert.equal(empty.tone, "empty_query");
  });

  it("catch path keeps honest unreachable copy", () => {
    const failure = researchFailureFromCatch(new Error("Failed to fetch"), {
      query: "harbor",
      surface: "chat",
    });
    assert.match(failure.message, /No citations were created|Failed to fetch/);
    assert.doesNotMatch(failure.message, /sources found/i);
    assert.equal(failure.target, "search");
    assert.deepEqual(snapshotResearchFailureParams(failure.params), { query: "harbor", surface: "chat" });
  });

  it("researchFailureMessage never invents source counts on bare errors", () => {
    assert.equal(
      researchFailureMessage("", false),
      HONEST_FAILURE_MESSAGES.research_not_configured,
    );
    assert.match(researchFailureMessage("boom", true), /No citations were created/);
    assert.doesNotMatch(researchFailureMessage("boom", true), /\d+\s+sources/i);
  });

  it("renders ResearchFailureBanner with Retry and View log markers", () => {
    const outcome = researchFailureFromResult(failed(SEARCH_TIMEOUT_REPLY), {
      query: "timeout query",
      surface: "research_page",
    });
    assert.equal(outcome.tone, "failure");
    if (outcome.tone !== "failure") return;
    const calls: string[] = [];
    const html = renderToStaticMarkup(
      createElement(ResearchFailureBanner, {
        failure: outcome.failure,
        onRetry: () => calls.push("retry"),
        onViewLog: () => calls.push("log"),
        onOpenResearch: () => calls.push("open"),
      }),
    );
    assert.match(html, /data-testid="failure-banner"/);
    assert.match(html, /role="alert"/);
    assert.match(html, /border-danger\/40/);
    assert.match(html, /data-failure-kind="research_failed"/);
    assert.match(html, /data-testid="failure-retry"/);
    assert.match(html, /data-testid="failure-view-log"/);
    assert.match(html, /data-testid="research-open-page"/);
    assert.match(html, /Search timed out/);
  });

  it("renders ResearchPartialWarningBanner as status warning with citations preserved in props", () => {
    const citations = [{ title: "Kept", url: "https://example.com/kept" }];
    const html = renderToStaticMarkup(
      createElement(ResearchPartialWarningBanner, {
        warning: {
          tone: "partial",
          message: HONEST_FAILURE_MESSAGES.research_partial,
          citations,
          summary: "kept 1",
          params: { query: "q", surface: "research_page" },
        },
        onRetry: () => undefined,
        onViewLog: () => undefined,
      }),
    );
    assert.match(html, /data-testid="research-partial-banner"/);
    assert.match(html, /role="status"/);
    assert.match(html, /border-warning\/40/);
    assert.match(html, /data-failure-kind="research_partial"/);
    assert.doesNotMatch(html, /role="alert"/);
    assert.match(html, /Only confirmed sources are listed/);
  });

  it("exports a mount hint for command-app without editing it here", () => {
    assert.match(researchFailureMountHint(), /researchFailureFromResult/);
    assert.match(researchFailureMountHint(), /reportFailure/);
    assert.match(researchFailureMountHint(), /ResearchPartialWarningBanner/);
  });
});
