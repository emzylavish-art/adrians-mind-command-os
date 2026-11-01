import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  COPY_CODE_FAILED,
  CopyCodeFailureBanner,
  onceRetry,
  resolveClipboardWriter,
  runCopyCode,
  snapshotCopyCodeParams,
} from "./copy-code-action.ts";

describe("Copy code clipboard failures", () => {
  it("snapshots identical block index and code for Retry", () => {
    assert.deepEqual(snapshotCopyCodeParams(2, "const x = 1;\n"), { blockIndex: 2, code: "const x = 1;\n" });
  });

  it("missing clipboard API is an error, not silent", async () => {
    assert.equal(resolveClipboardWriter({}), null);
    const params = snapshotCopyCodeParams(0, "hi");
    const result = await runCopyCode(params, null);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.message, COPY_CODE_FAILED);
    assert.deepEqual(result.params, params);
    const html = renderToStaticMarkup(
      createElement(CopyCodeFailureBanner, {
        state: { status: "error", message: result.message, params: result.params },
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /failure-banner/);
    assert.match(html, /failure-retry/);
    assert.match(html, /Could not copy that code/);
  });

  it("rejected writeText shows banner; Retry re-copies identical text once", async () => {
    const params = snapshotCopyCodeParams(1, "SELECT 1");
    let calls = 0;
    const seen: string[] = [];
    const writer = {
      writeText: async (text: string) => {
        calls += 1;
        seen.push(text);
        if (calls === 1) throw new Error("NotAllowedError");
      },
    };
    let result = await runCopyCode(params, writer);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const pending: Promise<Awaited<ReturnType<typeof runCopyCode>>>[] = [];
    const retry = onceRetry(() => {
      pending.push(runCopyCode(result.ok === false ? result.params : params, writer));
    });
    assert.ok(retry);
    retry!();
    retry!();
    assert.equal(pending.length, 1);
    result = await pending[0];
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
    assert.deepEqual(seen, ["SELECT 1", "SELECT 1"]);
  });

  it("successful copy has no banner", async () => {
    const params = snapshotCopyCodeParams(0, "ok");
    const result = await runCopyCode(params, { writeText: async () => undefined });
    assert.deepEqual(result, { ok: true, blockIndex: 0 });
    assert.equal(
      renderToStaticMarkup(createElement(CopyCodeFailureBanner, { state: { status: "ok", blockIndex: 0 }, onRetry: () => undefined })),
      "",
    );
  });
});
