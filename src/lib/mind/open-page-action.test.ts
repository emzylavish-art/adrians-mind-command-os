import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { classifyHonestFailure, HONEST_FAILURE_MESSAGES } from "./failure-states.ts";
import {
  OpenPageActionStatusRows,
  onceRetry,
  runOpenPage,
  snapshotOpenPageParams,
} from "./open-page-action.ts";

describe("Open page action failures", () => {
  it("classifies open_page_failed as network_failure", () => {
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.open_page_failed), "network_failure");
    assert.equal(classifyHonestFailure("The page was not opened."), "network_failure");
  });

  it("snapshots URL so Retry keeps the identical page", () => {
    assert.deepEqual(snapshotOpenPageParams("https://example.com/a"), { url: "https://example.com/a" });
  });

  it("ok:false inspect result becomes an error with the same URL params", async () => {
    const params = snapshotOpenPageParams("https://example.com/fail");
    const result = await runOpenPage(params, async () => ({
      ok: false as const,
      title: "",
      excerpt: "",
      error: "Only an http(s) page without credentials can be opened. No page was opened.",
    }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.params, params);
    assert.match(result.message, /http\(s\)|was not opened/i);
  });

  it("network rejection shows the red banner; Retry re-opens identical URL once", async () => {
    const params = snapshotOpenPageParams("https://example.com/retry");
    let calls = 0;
    const seen: string[] = [];
    const inspect = async (input: { data: { url: string } }) => {
      calls += 1;
      seen.push(input.data.url);
      if (calls === 1) throw new TypeError("Failed to fetch");
      return { ok: true as const, title: "Example", excerpt: "hello" };
    };
    let result = await runOpenPage(params, inspect);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const html = renderToStaticMarkup(
      createElement(OpenPageActionStatusRows, {
        state: { status: "error", kind: result.kind, message: result.message, params: result.params },
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /failure-banner/);
    assert.match(html, /failure-retry/);
    assert.match(html, /data-open-page-url="https:\/\/example.com\/retry"/);

    const pending: Promise<Awaited<ReturnType<typeof runOpenPage>>>[] = [];
    const retry = onceRetry(() => {
      pending.push(runOpenPage(result.ok === false ? result.params : params, inspect));
    });
    assert.ok(retry);
    retry!();
    retry!();
    assert.equal(pending.length, 1);
    result = await pending[0];
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.note, "Example\nhello");
    assert.deepEqual(seen, ["https://example.com/retry", "https://example.com/retry"]);
  });

  it("successful open returns note without a banner", async () => {
    const params = snapshotOpenPageParams("https://example.com/ok");
    const result = await runOpenPage(params, async () => ({
      ok: true as const,
      title: "OK",
      excerpt: "body",
    }));
    assert.deepEqual(result, { ok: true, note: "OK\nbody", params });
    assert.equal(
      renderToStaticMarkup(
        createElement(OpenPageActionStatusRows, {
          state: { status: "ok", note: "OK\nbody" },
          onRetry: () => undefined,
        }),
      ),
      "",
    );
  });
});
