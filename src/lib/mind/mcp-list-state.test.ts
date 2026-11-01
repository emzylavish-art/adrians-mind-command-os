import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HONEST_FAILURE_MESSAGES } from "./failure-states.ts";
import {
  MCP_LIST_EMPTY_COPY,
  MCP_LIST_LOADING_COPY,
  MCP_LIST_SIGN_IN_COPY,
  McpListStatusRows,
  classifyMcpListFailure,
  loadMcpList,
  onceListRetry,
  type McpListState,
} from "./mcp-list-state.ts";

const render = (state: McpListState, viewLog = true) =>
  renderToStaticMarkup(createElement(McpListStatusRows, { state, onRetry: () => {}, onViewLog: viewLog ? () => {} : null }));

function httpError(status: number, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), { status });
}

describe("MCP list: loading / empty / error are distinct", () => {
  it("loading renders a busy status row, never the empty copy or a banner", () => {
    const html = render({ status: "loading" });
    assert.match(html, /data-testid="mcp-list-loading"/);
    assert.match(html, new RegExp(MCP_LIST_LOADING_COPY));
    assert.doesNotMatch(html, /failure-banner|mcp-list-empty/);
  });

  it("empty only when the load succeeded with zero servers", async () => {
    const state = await loadMcpList(async () => ({ servers: [] }));
    assert.deepEqual(state, { status: "ready", servers: [] });
    const html = render(state);
    assert.match(html, /data-testid="mcp-list-empty"/);
    assert.match(html, new RegExp(MCP_LIST_EMPTY_COPY));
    assert.doesNotMatch(html, /failure-banner/);
  });

  it("ready with servers renders no status row", async () => {
    const state = await loadMcpList(async () => ({ servers: [{ id: "builtin", label: "Built-in", kind: "builtin", enabled: true }] }));
    assert.equal(state.status, "ready");
    assert.equal(render(state), "");
  });

  it("typed unauthenticated payload is a quiet sign-in empty state (no banner)", async () => {
    const state = await loadMcpList(async () => ({ status: "unauthenticated", servers: [] }));
    assert.equal(state.status, "unauthenticated");
    const html = render(state);
    assert.match(html, /data-testid="mcp-list-sign-in"/);
    assert.match(html, new RegExp(MCP_LIST_SIGN_IN_COPY));
    assert.doesNotMatch(html, /failure-banner|role="alert"|border-danger/);
  });

  it("thrown 401 / Unauthorized become quiet unauthenticated, not a red banner", async () => {
    for (const fetcher of [async () => { throw httpError(401); }, async () => { throw new Error("Unauthorized"); }, async () => { throw new Error("Sign in is required."); }]) {
      const state = await loadMcpList(fetcher);
      assert.equal(state.status, "unauthenticated");
      assert.doesNotMatch(render(state), /failure-banner/);
    }
  });

  it("signed-in list with servers is ready", async () => {
    const state = await loadMcpList(async () => ({ status: "ok", servers: [{ id: "builtin", label: "Built-in", kind: "builtin", enabled: true }] }));
    assert.equal(state.status, "ready");
    if (state.status === "ready") assert.equal(state.servers.length, 1);
  });

  const errorCases: [string, () => Promise<unknown>, string, RegExp][] = [
    ["403 cross-site", async () => { throw httpError(403, "Forbidden: cross-site request blocked"); }, "forbidden_cross_site", /cross-site request blocked/],
    ["403 status only", async () => { throw httpError(403); }, "forbidden_cross_site", /Forbidden/],
    ["500", async () => { throw httpError(500); }, "network_failure", /HTTP 500/],
    ["503 via response.status", async () => { throw Object.assign(new Error("x"), { response: { status: 503 } }); }, "network_failure", /HTTP 503/],
    ["network rejection", async () => { throw new TypeError("Failed to fetch"); }, "network_failure", /network request failed/],
    ["non-JSON SyntaxError", async () => { throw new SyntaxError("Unexpected token < in JSON at position 0"); }, "network_failure", /not JSON/],
    ["non-JSON body (string)", async () => "<html>oops</html>", "network_failure", /not JSON/],
    ["malformed body", async () => ({ servers: [{ nope: 1 }] }), "network_failure", /not JSON/],
  ];
  for (const [name, fetcher, kind, copy] of errorCases) {
    it(`error (${name}) shows the red failure banner, not the empty state`, async () => {
      const state = await loadMcpList(fetcher);
      assert.equal(state.status, "error");
      if (state.status !== "error") return;
      assert.equal(state.kind, kind);
      assert.match(state.message, copy);
      const html = render(state);
      assert.match(html, /role="alert"/);
      assert.match(html, /data-testid="failure-banner"/);
      assert.match(html, new RegExp(`data-failure-kind="${kind}"`));
      assert.match(html, /border-danger\/40 bg-danger\/10/);
      assert.match(html, /data-testid="failure-retry"/);
      assert.match(html, /data-testid="failure-view-log"/);
      assert.doesNotMatch(html, /mcp-list-empty|No MCP servers/);
    });
  }

  it("list-failed copy keeps the failure-states classifier mapping", () => {
    assert.match(classifyMcpListFailure(new Error("boom")).message, new RegExp(HONEST_FAILURE_MESSAGES.mcp_list_failed));
  });
});

describe("MCP list Retry", () => {
  it("re-runs the same list load exactly once, then loads successfully", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      if (calls === 1) throw httpError(500);
      return { servers: [{ id: "a", label: "A", kind: "http", enabled: true }] };
    };
    let state = await loadMcpList(fetcher);
    assert.equal(state.status, "error");
    const pending: Promise<McpListState>[] = [];
    const retry = onceListRetry(() => { pending.push(loadMcpList(fetcher)); });
    retry();
    retry();
    assert.equal(pending.length, 1);
    state = await pending[0];
    assert.equal(calls, 2);
    assert.equal(state.status, "ready");
  });

  it("Retry button in the banner invokes the handler", () => {
    let clicked = 0;
    const el = McpListStatusRows({ state: { status: "error", kind: "network_failure", message: "x" }, onRetry: () => { clicked += 1; } });
    const buttons = (el as unknown as { props: { children: unknown[] } }).props.children[1] as { props: { children: { props: { onClick: () => void } }[] } };
    buttons.props.children[0].props.onClick();
    assert.equal(clicked, 1);
  });
});
