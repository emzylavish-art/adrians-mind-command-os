import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { emitFailure, mountFailure, surfaceForReport, type MountedFailure } from "../../lib/mind/failure-mount.ts";
import { useMcpFailureMount, type McpReportedOutcome } from "./use-mcp-failure-mount.ts";
import { installTestDom } from "./test-dom.ts";

installTestDom();

type Payload = MountedFailure<McpReportedOutcome>;
function Host({ seen }: { seen: Payload[] }) {
  const [failure, setFailure] = useState<Payload | null>(null);
  useMcpFailureMount((payload) => { seen.push(payload); setFailure(payload); });
  return failure ? createElement("div", { role: "alert", "data-local-id": failure.localCorrelationId },
    failure.outcome.message,
    failure.outcome.retryable ? createElement("button", { onClick: failure.retry }, "Retry") : null,
  ) : null;
}
function host(): { element: HTMLDivElement; root: Root } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return { element, root: createRoot(element) };
}
const outcome = { message: "MCP server list failed.", action: "mcp_list_failed", target: "mcp:tools", retryable: true };

describe("mounted production MCP failure hook", { concurrency: false }, () => {
  it("preserves one local ID, presents once, retries once and cleans up on unmount", async () => {
    const mounted = host(); const seen: Payload[] = []; let retries = 0;
    await act(async () => mounted.root.render(createElement(Host, { seen })));
    await act(async () => assert.equal(emitFailure("mcp", mountFailure(outcome, () => { retries += 1; }, "local-exact-1")), true));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].localCorrelationId, "local-exact-1");
    assert.equal(mounted.element.querySelector("[role=alert]")?.getAttribute("data-local-id"), "local-exact-1");
    await act(async () => { mounted.element.querySelector<HTMLButtonElement>("button")?.click(); mounted.element.querySelector<HTMLButtonElement>("button")?.click(); });
    assert.equal(retries, 1);
    await act(async () => mounted.root.unmount());
    seen[0].retry();
    assert.equal(retries, 1);
    assert.equal(emitFailure("mcp", mountFailure(outcome, () => {}, "after-unmount")), false);
    mounted.element.parentNode?.removeChild(mounted.element);
  });

  it("old cleanup does not remove a newer owner's subscription", async () => {
    const first = host(), second = host(); const a: Payload[] = [], b: Payload[] = [];
    await act(async () => first.root.render(createElement(Host, { seen: a })));
    await act(async () => second.root.render(createElement(Host, { seen: b })));
    await act(async () => first.root.unmount());
    await act(async () => assert.equal(emitFailure("mcp", mountFailure(outcome, () => {}, "new-owner")), true));
    assert.equal(a.length, 0); assert.equal(b.length, 1);
    await act(async () => second.root.unmount());
    assert.equal(emitFailure("mcp", mountFailure(outcome, () => {})), false);
    first.element.parentNode?.removeChild(first.element); second.element.parentNode?.removeChild(second.element);
  });

  it("remounting does not duplicate delivery and malformed outcomes do not expose data", async () => {
    const first = host(); const seen: Payload[] = [];
    await act(async () => first.root.render(createElement(Host, { seen })));
    await act(async () => first.root.unmount());
    const second = host();
    await act(async () => second.root.render(createElement(Host, { seen })));
    await act(async () => emitFailure("mcp", mountFailure({ private: "must-not-be-shown" }, () => { throw Error("No retry"); }, "validated")));
    assert.equal(seen.length, 1); assert.equal(seen[0].localCorrelationId, "validated");
    assert.equal(seen[0].outcome.retryable, false);
    assert.equal(second.element.textContent?.includes("must-not-be-shown"), false);
    assert.equal(second.element.querySelector("button"), null);
    await act(async () => second.root.unmount());
    first.element.parentNode?.removeChild(first.element); second.element.parentNode?.removeChild(second.element);
  });

  it("invalidates a displayed retry when its owning component unmounts", async () => {
    const mounted = host(); const seen: Payload[] = []; let calls = 0;
    await act(async () => mounted.root.render(createElement(Host, { seen })));
    await act(async () => emitFailure("mcp", mountFailure(outcome, () => { calls += 1; })));
    await act(async () => mounted.root.unmount());
    seen[0].retry(); assert.equal(calls, 0);
    mounted.element.parentNode?.removeChild(mounted.element);
  });

  it("actual Tools MCP callbacks identify MCP while browser default stays separate", () => {
    const fleet = readFileSync(new URL("./fleet-panels.tsx", import.meta.url), "utf8");
    const app = readFileSync(new URL("./command-app.tsx", import.meta.url), "utf8");
    assert.match(fleet, /onceListRetry\(loadMcpServers\), "mcp"/);
    assert.match(fleet, /onceListRetry\(loadMcpTools\), "mcp"/);
    assert.match(app, /useMcpFailureMount\(/);
    assert.match(app, /surface === "mcp" \? "mcp:tools" : "browser"/);
    assert.equal(surfaceForReport("mcp_tool_failed", "mcp:tools"), "mcp");
    assert.notEqual(surfaceForReport("open_page_failed", "browser"), "mcp");
  });
});
