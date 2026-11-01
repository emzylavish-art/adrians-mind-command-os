import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CHAT_TIMEOUT_REPLY,
  HONEST_FAILURE_MESSAGES,
  STOPPED_REPLY,
  classifyHonestFailure,
  shouldShowFailureBanner,
  bindRetry,
} from "./failure-states.ts";

/** Mirrors the production failure-banner markup contract in command-app.tsx. */
function FailureBannerFixture({
  message,
  onRetry,
  onViewLog,
}: {
  message: string;
  onRetry: () => void;
  onViewLog: () => void;
}) {
  return createElement(
    "div",
    {
      className: "flex flex-wrap items-center justify-between gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2",
      role: "alert",
      "data-testid": "failure-banner",
      "data-failure-kind": classifyHonestFailure(message) ?? "unknown",
    },
    createElement("p", { className: "text-sm text-danger" }, message),
    createElement(
      "div",
      { className: "flex flex-wrap gap-2" },
      createElement("button", { type: "button", "data-testid": "failure-retry", onClick: onRetry }, "Retry"),
      createElement("button", { type: "button", "data-testid": "failure-view-log", onClick: onViewLog }, "View log"),
    ),
  );
}

describe("failure banner markup contract", () => {
  const cases = [
    ["model_unavailable", HONEST_FAILURE_MESSAGES.model_unreachable],
    ["database_write_failed", HONEST_FAILURE_MESSAGES.database_write_failed],
    ["emergency_stop_active", HONEST_FAILURE_MESSAGES.emergency_stop_active],
    ["mcp_tool_failed", HONEST_FAILURE_MESSAGES.mcp_tool_failed],
    ["mcp_tool_failed", "MCP tool “pglite_query” failed. PGLite query error: boom"],
    ["chat_timeout", CHAT_TIMEOUT_REPLY],
    ["network_failure", "Failed to fetch"],
    ["auth_required", HONEST_FAILURE_MESSAGES.auth_required],
    ["forbidden_cross_site", HONEST_FAILURE_MESSAGES.forbidden_cross_site],
    ["rate_limited", "grok rate limited the request. Nothing was substituted."],
    ["image_generation_failed", HONEST_FAILURE_MESSAGES.image_generation_failed],
    ["image_generation_failed", HONEST_FAILURE_MESSAGES.image_generation_rate_limited],
    ["image_generation_failed", "Imagine failed (HTTP 502)."],
  ] as const;

  for (const [kind, message] of cases) {
    it(`renders red alert banner for ${kind} (${message.slice(0, 24)}) with Retry and View log`, () => {
      const calls: string[] = [];
      const retry = bindRetry((label: string) => calls.push(label), [`retry-${kind}`] as [string]);
      const html = renderToStaticMarkup(
        createElement(FailureBannerFixture, {
          message,
          onRetry: retry,
          onViewLog: () => calls.push(`log-${kind}`),
        }),
      );
      assert.match(html, /data-testid="failure-banner"/);
      assert.match(html, /role="alert"/);
      assert.match(html, /border-danger\/40/);
      assert.match(html, /bg-danger\/10/);
      assert.match(html, /text-danger/);
      assert.match(html, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(html, /data-testid="failure-retry"/);
      assert.match(html, />Retry</);
      assert.match(html, /data-testid="failure-view-log"/);
      assert.match(html, />View log</);
      assert.match(html, new RegExp(`data-failure-kind="${kind}"`));
      // identical-params retry still wired
      retry();
      assert.deepEqual(calls, [`retry-${kind}`]);
    });
  }
});

describe("H22 STOPPED_REPLY is not a red failure banner", () => {
  it("classifyHonestFailure leaves STOPPED_REPLY unclassified and shouldShowFailureBanner is false", () => {
    assert.equal(classifyHonestFailure(STOPPED_REPLY), null);
    assert.equal(shouldShowFailureBanner(STOPPED_REPLY), false);
  });
});
