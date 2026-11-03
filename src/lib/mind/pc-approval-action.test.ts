import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { classifyHonestFailure, HONEST_FAILURE_MESSAGES } from "./failure-states.ts";
import {
  PcApprovalActionStatusRows,
  classifyPcApprovalActionFailure,
  onceRetry,
  pcApprovalActionBody,
  runPcApprovalAction,
  snapshotPcApprovalActionParams,
  type PcApprovalActionParams,
} from "./pc-approval-action.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PC approve/deny action failures", () => {
  it("classifies 401/500/network without looking like a muted note", () => {
    assert.equal(classifyPcApprovalActionFailure("approve", Object.assign(new Error("Unauthorized"), { status: 401 })).kind, "auth_required");
    assert.match(classifyPcApprovalActionFailure("deny", Object.assign(new Error("HTTP 500"), { status: 500 })).message, /denial could not be completed/);
    assert.match(classifyPcApprovalActionFailure("approve", new Error("Failed to fetch")).message, /approval could not be completed/);
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.pc_approve_failed), "network_failure");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.pc_deny_failed), "network_failure");
  });

  it("snapshots approve params so Retry keeps identical id/token/command", () => {
    const params: PcApprovalActionParams = {
      action: "approve",
      approvalId: "appr_1",
      token: "tok_abc",
      command: "rm -rf /tmp/x",
    };
    assert.deepEqual(snapshotPcApprovalActionParams(params), params);
    assert.deepEqual(pcApprovalActionBody(params), {
      approvalId: "appr_1",
      token: "tok_abc",
      command: "rm -rf /tmp/x",
    });
  });

  it("HTTP ok:false becomes an error result with the same params for Retry", async () => {
    const params = snapshotPcApprovalActionParams({
      action: "approve",
      approvalId: "a1",
      token: "t1",
      command: "echo hi",
    });
    const result = await runPcApprovalAction(params, async () => jsonResponse(200, { ok: false, error: "expired" }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.params, params);
    assert.match(result.message, /approval could not be completed|expired/);
  });

  it("network rejection shows the red banner; Retry re-runs identical params once", async () => {
    const params = snapshotPcApprovalActionParams({
      action: "deny",
      approvalId: "a2",
      token: "t2",
    });
    let calls = 0;
    const seen: unknown[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      calls += 1;
      seen.push(JSON.parse(String(init.body)));
      if (calls === 1) throw new TypeError("Failed to fetch");
      return jsonResponse(200, { ok: true });
    };
    let result = await runPcApprovalAction(params, fetchImpl);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const html = renderToStaticMarkup(
      createElement(PcApprovalActionStatusRows, {
        state: { status: "error", kind: result.kind, message: result.message, params: result.params },
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /failure-banner/);
    assert.match(html, /failure-retry/);

    const pending: Promise<Awaited<ReturnType<typeof runPcApprovalAction>>>[] = [];
    const retry = onceRetry(() => {
      pending.push(runPcApprovalAction(result.ok === false ? result.params : params, fetchImpl));
    });
    assert.ok(retry);
    retry!();
    retry!();
    assert.equal(pending.length, 1);
    result = await pending[0];
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
    assert.deepEqual(seen[0], seen[1]);
    assert.deepEqual(seen[0], { approvalId: "a2", token: "t2" });
  });

  it("successful approve returns ok note without a banner", async () => {
    const params = snapshotPcApprovalActionParams({
      action: "approve",
      approvalId: "a3",
      token: "t3",
      command: "ls",
    });
    const result = await runPcApprovalAction(params, async () => jsonResponse(200, { ok: true, text: "done" }));
    assert.deepEqual(result, { ok: true, note: "ok: done" });
    assert.equal(
      renderToStaticMarkup(createElement(PcApprovalActionStatusRows, { state: { status: "ok", note: "ok: done" }, onRetry: () => undefined })),
      "",
    );
  });
});
