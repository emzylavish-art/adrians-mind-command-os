import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { classifyHonestFailure, HONEST_FAILURE_MESSAGES } from "./failure-states.ts";
import {
  OauthBoardActionStatusRows,
  classifyOauthBoardActionFailure,
  onceRetry,
  oauthBoardActionUrl,
  runOauthBoardAction,
  snapshotOauthBoardActionParams,
  type OauthBoardActionParams,
} from "./oauth-board-action.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OAuth board connect/disconnect action failures", () => {
  it("classifies 401/500/network without looking like a muted note", () => {
    assert.equal(
      classifyOauthBoardActionFailure("connect", "Gmail", Object.assign(new Error("Unauthorized"), { status: 401 })).kind,
      "auth_required",
    );
    assert.match(
      classifyOauthBoardActionFailure("disconnect", "Notion", Object.assign(new Error("HTTP 500"), { status: 500 })).message,
      /Disconnect failed/,
    );
    assert.match(
      classifyOauthBoardActionFailure("connect", "Slack", new Error("Failed to fetch")).message,
      /OAuth could not be started/,
    );
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.oauth_disconnect_failed), "network_failure");
    assert.equal(classifyHonestFailure("Gmail OAuth could not be started. Nothing was connected."), "network_failure");
  });

  it("snapshots connect params so Retry keeps identical name/path", () => {
    const params: OauthBoardActionParams = { action: "connect", name: "Gmail", path: "gmail" };
    assert.deepEqual(snapshotOauthBoardActionParams(params), params);
    assert.equal(oauthBoardActionUrl(params), "/api/mind/oauth/gmail/start?format=json");
    assert.equal(
      oauthBoardActionUrl({ action: "disconnect", name: "Gmail", path: "gmail" }),
      "/api/mind/oauth/gmail/disconnect",
    );
  });

  it("HTTP ok:false connect becomes an error result with the same params for Retry", async () => {
    const params = snapshotOauthBoardActionParams({ action: "connect", name: "GitHub", path: "github" });
    const result = await runOauthBoardAction(params, async () =>
      jsonResponse(200, { ok: false, error: "OAuth is not configured for github." }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.params, params);
    assert.match(result.message, /OAuth could not be started|not configured/i);
  });

  it("network rejection shows the red banner; Retry re-runs identical disconnect params once", async () => {
    const params = snapshotOauthBoardActionParams({ action: "disconnect", name: "Notion", path: "notion" });
    let calls = 0;
    const seen: string[] = [];
    const fetchImpl = async (url: string) => {
      calls += 1;
      seen.push(url);
      if (calls === 1) throw new TypeError("Failed to fetch");
      return jsonResponse(200, { state: "not_connected", detail: "Disconnected." });
    };
    let result = await runOauthBoardAction(params, fetchImpl);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const html = renderToStaticMarkup(
      createElement(OauthBoardActionStatusRows, {
        state: { status: "error", kind: result.kind, message: result.message, params: result.params },
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /failure-banner/);
    assert.match(html, /failure-retry/);
    assert.match(html, /data-oauth-board-action="disconnect"/);

    const pending: Promise<Awaited<ReturnType<typeof runOauthBoardAction>>>[] = [];
    const retry = onceRetry(() => {
      pending.push(runOauthBoardAction(result.ok === false ? result.params : params, fetchImpl));
    });
    assert.ok(retry);
    retry!();
    retry!();
    assert.equal(pending.length, 1);
    result = await pending[0];
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
    assert.deepEqual(seen[0], seen[1]);
    assert.equal(seen[0], "/api/mind/oauth/notion/disconnect");
  });

  it("successful connect returns redirectUrl without a banner", async () => {
    const params = snapshotOauthBoardActionParams({ action: "connect", name: "Slack", path: "slack" });
    const result = await runOauthBoardAction(params, async () =>
      jsonResponse(200, { ok: true, url: "https://example.com/oauth" }),
    );
    assert.deepEqual(result, {
      ok: true,
      note: "Slack OAuth start ready.",
      name: "Slack",
      redirectUrl: "https://example.com/oauth",
    });
    assert.equal(
      renderToStaticMarkup(
        createElement(OauthBoardActionStatusRows, {
          state: { status: "ok", note: "Slack OAuth start ready.", name: "Slack" },
          onRetry: () => undefined,
        }),
      ),
      "",
    );
  });
});
