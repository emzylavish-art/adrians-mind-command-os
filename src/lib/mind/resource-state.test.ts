import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceState, RESOURCE_STATE_LABELS, type ResourcePhase } from "../../components/mind/resource-state.ts";

test("shared states keep consistent semantics and never execute recovery when rendered", () => {
  let executions = 0;
  for (const phase of Object.keys(RESOURCE_STATE_LABELS) as ResourcePhase[]) {
    const markup = renderToStaticMarkup(createElement(ResourceState, { phase, action: { label: "Review recovery", run: () => { executions++; } } }, "Account-owned resource"));
    assert.match(markup, /aria-live="polite"/);
    assert.match(markup, new RegExp(`data-resource-state="${phase}"`));
    assert.match(markup, /type="button"/);
    assert.match(markup, /min-h-11/);
    if (phase === "loading") assert.match(markup, /disabled=""/);
  }
  assert.equal(executions, 0);
});
