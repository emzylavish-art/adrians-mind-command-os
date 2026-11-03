import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { performSearch, resolveDeepPlan, buildResearchReport, researchReportToMarkdown, FROM_YOUR_FILE, citationsFromUploads } from "./research.ts";
import { runResearchSession } from "./research-session-exec.ts";
import {
  cancelResearchInMemory,
  memoryGetResearch,
  resetResearchSessionStoreForTests,
  startResearchInMemory,
  subscribeResearch,
} from "./research-session-store.ts";
import { RESEARCH_TERMINAL } from "./research-session.ts";
import { XAI_MIND_SEARCH_ADAPTER_ENDPOINT } from "./xai-search-adapter.ts";

describe("deep plan edit", () => {
  it("uses edited plan when non-empty and falls back otherwise", () => {
    assert.deepEqual(resolveDeepPlan("topic", ["a", "b"]), ["a", "b"]);
    assert.ok(resolveDeepPlan("topic", ["", "  "]).length >= 1);
    assert.ok(resolveDeepPlan("topic", null).length >= 2);
  });
});

describe("uploads → from your file", () => {
  it("cites excerpts without inventing URLs", () => {
    const cites = citationsFromUploads([
      { name: "notes.txt", mime: "text/plain", bytes: 12, excerpts: ["lake depth 40ft"] },
    ]);
    assert.equal(cites[0]?.url, FROM_YOUR_FILE);
    assert.match(cites[0]?.title ?? "", /lake depth/);
  });
});

describe("report + markdown export", () => {
  it("builds sections, gaps, and .md without invented links", () => {
    const report = buildResearchReport({
      query: "marina zoning",
      mode: "deep",
      citations: [{ title: "Guide", url: "https://example.com/g", source: "web" }],
      steps: [{ query: "marina zoning", ok: true, count: 1 }],
      partial: true,
    });
    assert.ok(report.sections.some((s) => s.id === "sources"));
    assert.ok(report.gaps.some((g) => /timed out/i.test(g)));
    const md = researchReportToMarkdown(report);
    assert.match(md, /# Deep research report/);
    assert.match(md, /https:\/\/example\.com\/g/);
    assert.equal(md.includes("https://invented.example"), false);
  });
});

describe("searchWeb deep flag passthrough (library)", () => {
  it("deep:true runs multi-step even for a short query; deep:false stays single", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return Response.json({ results: [{ title: `H${calls}`, url: `https://example.com/${calls}` }] });
    }) as typeof fetch;
    const deep = await performSearch({
      query: "short",
      deep: true,
      endpoint: "https://search.example/query",
      key: "k",
      fetchImpl,
    });
    assert.ok((deep.steps?.length ?? 0) >= 2);
    calls = 0;
    const shallow = await performSearch({
      query: "x".repeat(160),
      deep: false,
      endpoint: "https://search.example/query",
      key: "k",
      fetchImpl,
    });
    assert.equal(shallow.steps, undefined);
    assert.equal(calls, 1);
  });
});

describe("research session cancel + stream events", () => {
  it("abort cancels an in-flight deep run and keeps partial citations", async () => {
    resetResearchSessionStoreForTests();
    mock.timers.enable({ apis: ["setTimeout"], now: 0 });
    try {
      const session = startResearchInMemory({
        ownerId: "u1",
        query: "Toledo Bend marina zoning",
        mode: "deep",
        plan: ["q1", "q2"],
      });
      let calls = 0;
      const pending = runResearchSession(session.id, {
        env: {
          MIND_SEARCH_ENDPOINT: "https://search.example/query",
          MIND_SEARCH_KEY: "test-key",
        },
        fetchImpl: ((_url, init) => {
          calls += 1;
          if (calls === 1) {
            return Promise.resolve(Response.json({ results: [{ title: "Real", url: "https://example.com/real" }] }));
          }
          return new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) return;
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }) as typeof fetch,
      });
      // Let first step complete, then cancel.
      await Promise.resolve();
      await Promise.resolve();
      const cancelled = cancelResearchInMemory(session.id, "u1");
      assert.equal(cancelled.ok, true);
      mock.timers.tick(60_000);
      const final = await pending;
      assert.ok(final);
      assert.ok(RESEARCH_TERMINAL.has(final!.status));
      assert.equal(final!.citations.some((c) => c.url === "https://example.com/real"), true);
      assert.equal(JSON.stringify(final).includes("test-key"), false);
      assert.equal(XAI_MIND_SEARCH_ADAPTER_ENDPOINT.startsWith("mind://"), true);
    } finally {
      mock.timers.reset();
      resetResearchSessionStoreForTests();
    }
  });

  it("subscribe emits timeline events", () => {
    resetResearchSessionStoreForTests();
    const session = startResearchInMemory({ ownerId: "u1", query: "q", mode: "search" });
    const seen: number[] = [];
    const unsub = subscribeResearch(session.id, (next) => {
      seen.push(next.lastSeq);
    });
    cancelResearchInMemory(session.id, "u1");
    unsub();
    assert.ok(seen.length >= 1);
    assert.equal(memoryGetResearch(session.id)?.status, "cancelled");
    resetResearchSessionStoreForTests();
  });
});
