import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  citationCountFromResult,
  decideResearchAnnouncement,
  researchAnnouncementsEnabled,
  researchSteerAvailability,
  utteranceForComplete,
  utteranceForPlanReady,
  RESEARCH_PROGRESS_MIN_GAP_MS,
} from "./research-announce.ts";

describe("research-announce", () => {
  it("stays silent when announcements disabled", () => {
    const d = decideResearchAnnouncement(
      { type: "plan_ready", query: "deep research on batteries" },
      { announcementsEnabled: false },
    );
    assert.equal(d.speak, false);
    if (!d.speak) assert.equal(d.reason, "disabled");
  });

  it("stays silent for non-deep queries", () => {
    const d = decideResearchAnnouncement(
      { type: "plan_ready", query: "hello" },
      { announcementsEnabled: true },
    );
    assert.equal(d.speak, false);
    if (!d.speak) assert.equal(d.reason, "not_deep");
  });

  it("plan ready speaks planned search count, not sources", () => {
    const d = decideResearchAnnouncement(
      { type: "plan_ready", query: "deep research on solid state batteries" },
      { announcementsEnabled: true },
    );
    assert.equal(d.speak, true);
    if (d.speak) {
      assert.equal(d.phase, "plan_ready");
      assert.match(d.text, /plan ready/i);
      assert.match(d.text, /search/i);
      assert.doesNotMatch(d.text, /\d+ citation/i);
    }
    const u = utteranceForPlanReady("deep research on solid state batteries");
    assert.ok(u);
  });

  it("running announces once as status speech", () => {
    const d = decideResearchAnnouncement(
      { type: "running", query: "deep research on solid state batteries" },
      { announcementsEnabled: true },
    );
    assert.equal(d.speak, true);
    if (d.speak) {
      assert.equal(d.phase, "running");
      assert.match(d.text, /not a live voice conversation/i);
    }
  });

  it("progress is throttled", () => {
    const base = {
      type: "progress" as const,
      query: "deep research on solid state batteries",
      stepIndex: 2,
      stepTotal: 3,
      nowMs: 20_000,
      lastProgressMs: 20_000 - (RESEARCH_PROGRESS_MIN_GAP_MS - 100),
    };
    const throttled = decideResearchAnnouncement(base, { announcementsEnabled: true });
    assert.equal(throttled.speak, false);
    if (!throttled.speak) assert.equal(throttled.reason, "throttled");

    const ok = decideResearchAnnouncement(
      { ...base, lastProgressMs: 0 },
      { announcementsEnabled: true },
    );
    assert.equal(ok.speak, true);
    if (ok.speak) assert.match(ok.text, /search 2 of 3/i);
  });

  it("complete uses real citation count only", () => {
    const result = {
      ok: true,
      configured: true,
      citations: [
        { title: "A", url: "https://example.com/a" },
        { title: "B", url: "https://example.com/b" },
        { title: "bad", url: "not-a-url" },
      ],
      partial: false,
      error: "",
      steps: [{ query: "q", ok: true, count: 2 }],
    };
    assert.equal(citationCountFromResult(result), 2);
    const text = utteranceForComplete(result);
    assert.ok(text);
    assert.match(text!, /2 citation/);
    assert.doesNotMatch(text!, /3 citation/);

    const d = decideResearchAnnouncement(
      { type: "result", query: "deep research x", result },
      { announcementsEnabled: true },
    );
    assert.equal(d.speak, true);
    if (d.speak) assert.equal(d.phase, "complete");
  });

  it("partial and failed phases are honest", () => {
    const partial = decideResearchAnnouncement(
      {
        type: "result",
        query: "deep research x",
        result: {
          ok: true,
          configured: true,
          citations: [{ title: "A", url: "https://example.com/a" }],
          partial: true,
          error: "",
          steps: [{ query: "q", ok: true, count: 1 }],
        },
      },
      { announcementsEnabled: true },
    );
    assert.equal(partial.speak, true);
    if (partial.speak) {
      assert.equal(partial.phase, "partial");
      assert.match(partial.text, /partially/i);
      assert.match(partial.text, /1 confirmed citation/);
    }

    const failed = decideResearchAnnouncement(
      {
        type: "result",
        query: "deep research x",
        result: {
          ok: false,
          configured: true,
          citations: [],
          error: "timed out",
          steps: [{ query: "q", ok: false, count: 0 }],
        },
      },
      { announcementsEnabled: true },
    );
    assert.equal(failed.speak, true);
    if (failed.speak) {
      assert.equal(failed.phase, "failed");
      assert.match(failed.text, /No citations were created/);
    }
  });

  it("silent when search not configured — no fake status", () => {
    const d = decideResearchAnnouncement(
      {
        type: "result",
        query: "deep research x",
        result: {
          ok: false,
          configured: false,
          citations: [],
          error: "No search provider is configured.",
        },
      },
      { announcementsEnabled: true },
    );
    assert.equal(d.speak, false);
    if (!d.speak) assert.equal(d.reason, "not_configured");
    assert.equal(
      utteranceForComplete({
        ok: false,
        configured: false,
        citations: [],
        error: "No search provider is configured.",
      }),
      null,
    );
  });

  it("never invents sources in utterances", () => {
    const text = utteranceForComplete({
      ok: true,
      configured: true,
      citations: [],
      error: "",
    });
    assert.ok(text);
    assert.match(text!, /0 citation/);
    assert.doesNotMatch(text!, /https?:\/\//i);
    assert.doesNotMatch(text!, /example\.com/i);
  });

  it("toggle helper defaults on", () => {
    assert.equal(researchAnnouncementsEnabled(undefined), true);
    assert.equal(researchAnnouncementsEnabled({ announceResearch: false }), false);
  });

  it("research steer is unavailable on this branch", () => {
    const a = researchSteerAvailability({ hasBuildSessionSteerRoute: false, hasResearchSteerRoute: false });
    assert.equal(a.available, false);
    if (!a.available) assert.match(a.reason, /No research steer/i);
  });
});
