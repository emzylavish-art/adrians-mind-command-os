import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { reportSurfaceFailure } from "./surface-failure-host.ts";
import { emitFailure, registerFailureHandler, surfaceForReport, type FailureSurface, type MountedFailure } from "../../lib/mind/failure-mount.ts";
import { notionFailureFromCatch } from "../../lib/mind/notion-failure-action.ts";
import { classifyHonestFailure, HONEST_FAILURE_MESSAGES } from "../../lib/mind/failure-states.ts";
import { failureEnvelopeFromAction } from "../../lib/mind/failure-envelope.ts";

const surfaces: FailureSurface[] = ["mcp", "notion", "research", "serviceBoard", "supabase", "persona", "modelRoute"];

describe("mounted failure surfaces", () => {
  it("fires the registered handler and leaves the existing alert hidden", () => {
    const outcome = { message: "Sol needs config. Missing SOL_API_KEY." };
    const seen: { current: MountedFailure<typeof outcome> | null } = { current: null };
    const unregister = registerFailureHandler("modelRoute", (payload: MountedFailure<unknown>) => {
      seen.current = payload as MountedFailure<typeof outcome>;
    });
    const selection = { provider: "sol", logicRoute: "sol" };
    const result = reportSurfaceFailure({
      surface: "modelRoute",
      message: outcome.message,
      outcome,
      retry: () => selection,
    });
    assert.equal(result.handled, true);
    assert.equal(result.visible, null);
    assert.equal(seen.current?.outcome, outcome);
    assert.deepEqual(seen.current?.retry(), selection);
    unregister();
  });

  it("keeps the existing alert when no handler is registered", () => {
    const outcome = { message: "Notion could not be reached. Nothing was changed." };
    assert.equal(emitFailure("notion", { outcome, retry: () => undefined, localCorrelationId: "local" }), false);
    const result = reportSurfaceFailure({
      surface: "notion",
      message: outcome.message,
      outcome,
      retry: () => undefined,
    });
    assert.equal(result.handled, false);
    assert.equal(result.visible, outcome.message);
  });

  it("Notion timeout reaches the mounted handler with a fresh write review", () => {
    const outcome = notionFailureFromCatch(Object.assign(new Error("timeout"), { name: "TimeoutError" }), {
      text: "Append reviewed fixture", confirmed: true, pageId: "fixture-page", surface: "chat",
    });
    assert.equal(outcome.tone, "failure");
    if (outcome.tone !== "failure") return;
    assert.equal(outcome.failure.message, HONEST_FAILURE_MESSAGES.notion_timeout);
    assert.equal(outcome.failure.params.confirmed, false);
    assert.match(outcome.failure.message, /inspect|unknown|confirm|review/i);
    const surface = surfaceForReport(outcome.failure.auditAction, "notion");
    assert.equal(surface, "notion");
    let retried: typeof outcome.failure.params | null = null;
    const unregister = registerFailureHandler("notion", (payload) => payload.retry());
    try {
      const result = reportSurfaceFailure({ surface: "notion", message: outcome.failure.message, outcome,
        retry: () => { retried = outcome.failure.params; } });
      assert.equal(result.handled, true);
      assert.deepEqual(retried, { text: "Append reviewed fixture", confirmed: false, pageId: "fixture-page", surface: "chat" });
    } finally { unregister(); }
  });

  it("command-app routes failures through the shared emitter, with separate persona and Speak handling", () => {
    const app = readFileSync(new URL("./command-app.tsx", import.meta.url), "utf8");
    const persona = readFileSync(new URL("./persona-directory.tsx", import.meta.url), "utf8");
    assert.ok(/reportFailure\(message,\s*"notion_operation_failed",\s*"notion"/.test(app), "Notion operation failures must reach the common report route.");
    const inChatResearch = app.slice(app.indexOf("async function runWebResearch("), app.indexOf("async function askNotion("));
    const researchPage = app.slice(app.indexOf("async function startResearch("), app.indexOf("async function runPlanner("));
    for (const entry of [inChatResearch, researchPage]) {
      assert.match(entry, /reportFailure\([^;]*"research_failed"/);
      assert.match(entry, /data: \{ query, operationId,/);
      assert.match(entry, /subsystem: "research"/);
      assert.match(entry, /retryPolicy: "review"/);
      assert.match(entry, /revision: (?:result|retry)/);
    }
    assert.match(inChatResearch, /temporary: chat\.temporary/);
    assert.match(app, /emitFailure\("serviceBoard"/);
    assert.match(app, /emitFailure\(\s*surface/);
    assert.match(persona, /emitFailure\("persona"/);
    assert.equal(app.includes('emitFailure("speak"'), false);
    assert.equal(persona.includes('emitFailure("speak"'), false);
    for (const surface of surfaces) {
      const blob = `${app}\n${persona}`;
      if (surface === "persona") assert.match(blob, /emitFailure\("persona"/);
      else if (surface === "notion") {
        assert.equal(surfaceForReport("notion_operation_failed", "notion"), "notion");
        assert.equal(surfaceForReport("notion_outcome_unconfirmed", "notion"), "notion");
      } else if (surface === "research") {
        assert.equal(surfaceForReport("research_failed", "search"), "research");
      } else if (surface === "serviceBoard") {
        assert.match(blob, new RegExp(`emitFailure\\("${surface}"`));
      }
    }
    assert.match(app, /surfaceForReport/);
  });

  it("structured research metadata survives the mounted seam without wording-based reclassification", () => {
    const envelope = failureEnvelopeFromAction({ action: "research_failed", target: "search", message: "The artifact could not be saved.",
      subsystem: "research", operationId: "research-operation", provider: "configured-search", stage: "response", outcome: "unknown", operationKind: "generation", retryPolicy: "review" });
    const outcome = { message: envelope.message, action: "research_failed", target: "search", envelope, bindings: { reportId: "report-a", revision: "configuration-a" } };
    let received: typeof outcome | null = null;
    let repeated = 0;
    const unregister = registerFailureHandler("research", (payload) => { received = payload.outcome as typeof outcome; });
    try {
      const result = reportSurfaceFailure({ surface: "research", message: outcome.message, outcome, retry: () => { repeated++; } });
      assert.equal(result.handled, true);
      assert.equal(received, outcome);
      assert.equal(classifyHonestFailure(outcome.envelope), "research_failed");
      assert.equal(outcome.envelope.retryPolicy, "review");
      assert.equal(repeated, 0, "reporting a structured failure does not repeat the provider request");
    } finally { unregister(); }
    const legacy = reportSurfaceFailure({ surface: "research", message: "Legacy search failed.", outcome: { message: "Legacy search failed." }, retry: () => { repeated++; } });
    assert.equal(legacy.visible, "Legacy search failed.");
    assert.equal(repeated, 0);
  });
});
