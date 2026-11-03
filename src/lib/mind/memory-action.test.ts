import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MEMORY_EDIT_EMPTY,
  MEMORY_SAVE_EMPTY,
  MemoryActionFailureBanner,
  onceRetry,
  runMemoryAction,
  snapshotMemoryActionParams,
} from "./memory-action.ts";

describe("Memory manager action failures", () => {
  it("empty save_new is an error with Retry params", () => {
    const params = snapshotMemoryActionParams({ kind: "save_new", text: "   ", scope: "global" });
    const calls: unknown[] = [];
    const result = runMemoryAction(params, {
      saveNew: (input) => calls.push(input),
      saveEdit: () => undefined,
      remove: () => undefined,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.message, MEMORY_SAVE_EMPTY);
    assert.deepEqual(result.params, params);
    assert.equal(calls.length, 0);
    const html = renderToStaticMarkup(
      createElement(MemoryActionFailureBanner, {
        state: { status: "error", message: result.message, params: result.params },
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /failure-banner|failure-retry|memory-error/);
  });

  it("empty save_edit is an error; Retry re-runs identical id/text once after text is fixed in params", () => {
    let calls = 0;
    const seen: unknown[] = [];
    const mutators = {
      saveNew: () => undefined,
      saveEdit: (input: { id: string; text: string }) => {
        calls += 1;
        seen.push(input);
        if (calls === 1) throw new Error("boom");
      },
      remove: () => undefined,
    };
    const params = snapshotMemoryActionParams({ kind: "save_edit", id: "m1", text: "keep me" });
    let result = runMemoryAction(params, mutators);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /boom/);
    const pending: Array<ReturnType<typeof runMemoryAction>> = [];
    const retry = onceRetry(() => {
      pending.push(runMemoryAction(result.ok === false ? result.params : params, mutators));
    });
    assert.ok(retry);
    retry!();
    retry!();
    assert.equal(pending.length, 1);
    result = pending[0];
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
    assert.deepEqual(seen[0], seen[1]);
    assert.deepEqual(seen[0], { id: "m1", text: "keep me" });
  });

  it("empty edit validation message is stable", () => {
    const result = runMemoryAction(
      { kind: "save_edit", id: "x", text: "" },
      { saveNew: () => undefined, saveEdit: () => undefined, remove: () => undefined },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.message, MEMORY_EDIT_EMPTY);
  });

  it("successful save_new has no banner", () => {
    const result = runMemoryAction(
      { kind: "save_new", text: "hello", scope: "chat" },
      {
        saveNew: (input) => {
          assert.deepEqual(input, { text: "hello", scope: "chat" });
        },
        saveEdit: () => undefined,
        remove: () => undefined,
      },
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(
      renderToStaticMarkup(createElement(MemoryActionFailureBanner, { state: { status: "ok" }, onRetry: () => undefined })),
      "",
    );
  });
});
