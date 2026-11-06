import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HONEST_FAILURE_MESSAGES, MCP_AUTH_REQUIRED_NOTICE } from "./failure-states.ts";
import {
  LIST_AUTH_NOTICE_COPY,
  MCP_LIST_EMPTY_COPY,
  MCP_LIST_LOADING_COPY,
  MCP_LIST_SIGN_IN_COPY,
  MCP_LIST_LOAD_TIMEOUT_MS,
  MCP_TOOLS_EMPTY_COPY,
  MCP_TOOLS_LOADING_COPY,
  McpListStatusRows,
  McpToolsListStatusRows,
  PC_APPROVALS_EMPTY_COPY,
  PC_APPROVALS_LOADING_COPY,
  PcApprovalsListStatusRows,
  WORKER_HEALTH_LOADING_COPY,
  WorkerHealthStatusRows,
  classifyMcpListFailure,
  classifyListFailure,
  parsePcApprovalsResponse,
  PC_APPROVAL_STORAGE_FAILURE_COPY,
  isCurrentListGeneration,
  loadMcpList,
  loadMcpToolsList,
  loadPcApprovalsList,
  loadWorkerHealthStatus,
  nextListGeneration,
  onceListRetry,
  withListTimeout,
  type FleetListState,
  type McpListState,
  type McpToolRow,
  type PcApprovalRow,
  type WorkerHealthState,
} from "./mcp-list-state.ts";

const renderServers = (state: McpListState, viewLog = true) =>
  renderToStaticMarkup(createElement(McpListStatusRows, { state, onRetry: () => {}, onViewLog: viewLog ? () => {} : null }));

const renderTools = (state: FleetListState<McpToolRow>, viewLog = true) =>
  renderToStaticMarkup(createElement(McpToolsListStatusRows, { state, onRetry: () => {}, onViewLog: viewLog ? () => {} : null }));

const renderApprovals = (state: FleetListState<PcApprovalRow>, viewLog = true) =>
  renderToStaticMarkup(createElement(PcApprovalsListStatusRows, { state, onRetry: () => {}, onViewLog: viewLog ? () => {} : null }));

const renderWorkerHealth = (state: WorkerHealthState, viewLog = true) =>
  renderToStaticMarkup(createElement(WorkerHealthStatusRows, { state, onRetry: () => {}, onViewLog: viewLog ? () => {} : null }));

function httpError(status: number, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), { status });
}

const sampleTool: McpToolRow = {
  serverId: "builtin",
  serverLabel: "Built-in",
  name: "pglite_query",
  description: "SQL",
  enabled: true,
};

const sampleApproval: PcApprovalRow = {
  id: "a1",
  token: "t1",
  command: "dir",
  agentId: "agent",
  agentLabel: "Agent",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

describe("MCP list: loading / empty / error are distinct", () => {
  it("loading renders a busy status row, never the empty copy or a banner", () => {
    const html = renderServers({ status: "loading" });
    assert.match(html, /data-testid="mcp-list-loading"/);
    assert.match(html, new RegExp(MCP_LIST_LOADING_COPY));
    assert.doesNotMatch(html, /failure-banner|mcp-list-empty/);
  });

  it("empty only when the load succeeded with zero servers", async () => {
    const state = await loadMcpList(async () => ({ servers: [] }));
    assert.deepEqual(state, { status: "ready", servers: [] });
    const html = renderServers(state);
    assert.match(html, /data-testid="mcp-list-empty"/);
    assert.match(html, new RegExp(MCP_LIST_EMPTY_COPY));
    assert.doesNotMatch(html, /failure-banner/);
  });

  it("ready with servers renders no status row", async () => {
    const state = await loadMcpList(async () => ({ servers: [{ id: "builtin", label: "Built-in", kind: "builtin", enabled: true }] }));
    assert.equal(state.status, "ready");
    assert.equal(renderServers(state), "");
  });

  it("typed unauthenticated payload is a quiet sign-in empty state (no banner)", async () => {
    const state = await loadMcpList(async () => ({ status: "unauthenticated", servers: [] }));
    assert.equal(state.status, "unauthenticated");
    const html = renderServers(state);
    assert.match(html, /data-testid="mcp-list-sign-in"/);
    assert.match(html, /data-mcp-list-state="unauthenticated"/);
    assert.match(html, new RegExp(MCP_LIST_SIGN_IN_COPY));
    assert.doesNotMatch(html, /failure-banner|role="alert"|border-danger|failure-retry/);
    assert.doesNotMatch(html, /mcp-list-empty|No MCP servers/);
  });

  it("thrown 401 / Unauthorized become quiet unauthenticated, not a red banner", async () => {
    for (const fetcher of [
      async () => { throw httpError(401); },
      async () => { throw new Error("Unauthorized"); },
      async () => { throw new Error("Sign in is required."); },
    ]) {
      const state = await loadMcpList(fetcher);
      assert.equal(state.status, "unauthenticated");
      const html = renderServers(state);
      assert.match(html, /data-testid="mcp-list-sign-in"/);
      assert.match(html, /data-mcp-list-state="unauthenticated"/);
      assert.doesNotMatch(html, /failure-banner|failure-retry|role="alert"/);
    }
  });

  it("signed-in list with servers is ready", async () => {
    const state = await loadMcpList(async () => ({
      status: "ok",
      servers: [{ id: "builtin", label: "Built-in", kind: "builtin", enabled: true }],
    }));
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
      const html = renderServers(state);
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

describe("MCP list timeout + Retry", () => {
  it("reuses the existing 15s list timeout constant", () => {
    assert.equal(MCP_LIST_LOAD_TIMEOUT_MS, 15_000);
  });

  it("hung fetch times out into the error state and Retry can succeed", async () => {
    let calls = 0;
    const fetcher = () => {
      calls += 1;
      if (calls === 1) {
        return new Promise(() => {
          /* never settles — client timeout must win */
        });
      }
      return Promise.resolve({ servers: [{ id: "a", label: "A", kind: "http", enabled: true }] });
    };
    const first = await loadMcpList(fetcher, { timeoutMs: 30 });
    assert.equal(first.status, "error");
    if (first.status === "error") {
      assert.match(first.message, /timed out/i);
      assert.equal(first.kind, "network_failure");
    }
    const pending: Promise<McpListState>[] = [];
    const retry = onceListRetry(() => {
      pending.push(loadMcpList(fetcher, { timeoutMs: 30 }));
    });
    retry();
    retry();
    assert.equal(pending.length, 1);
    const second = await pending[0];
    assert.equal(calls, 2);
    assert.equal(second.status, "ready");
    if (second.status === "ready") assert.equal(second.servers[0]?.id, "a");
  });

  it("withListTimeout rejects a hung promise and leaves Retry enabled", async () => {
    await assert.rejects(() => withListTimeout(new Promise(() => {}), 20, "The MCP server list"), /timed out/);
  });
});

describe("stale list responses are ignored", () => {
  it("nextListGeneration bumps and isCurrentListGeneration gates older results", async () => {
    let generation = 0;
    const results: McpListState[] = [];
    const run = async (delayMs: number, payload: { servers: { id: string; label: string; kind: string; enabled: boolean }[] }) => {
      const mine = nextListGeneration(generation);
      generation = mine;
      await new Promise((r) => setTimeout(r, delayMs));
      const state = await loadMcpList(async () => payload, { timeoutMs: 200 });
      if (!isCurrentListGeneration(mine, generation)) return;
      results.push(state);
    };
    const slow = run(40, { servers: [{ id: "stale", label: "Stale", kind: "http", enabled: true }] });
    const fast = run(5, { servers: [{ id: "fresh", label: "Fresh", kind: "http", enabled: true }] });
    await Promise.all([slow, fast]);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.status, "ready");
    if (results[0]?.status === "ready") assert.equal(results[0].servers[0]?.id, "fresh");
  });
});

describe("MCP tools list: empty vs error", () => {
  it("rejected tools fetch shows the red banner, not the empty copy", async () => {
    const state = await loadMcpToolsList(async () => {
      throw httpError(500);
    });
    assert.equal(state.status, "error");
    if (state.status !== "error") return;
    assert.match(state.message, /MCP tools list/);
    const html = renderTools(state);
    assert.match(html, /failure-banner/);
    assert.match(html, /failure-retry/);
    assert.doesNotMatch(html, /mcp-tools-list-empty|No MCP tools/);
  });

  it("tools 401 is a dismissible notice, not a red Retry banner", async () => {
    const state = await loadMcpToolsList(async () => {
      throw httpError(401);
    });
    assert.equal(state.status, "error");
    if (state.status !== "error") return;
    assert.equal(state.kind, "auth_required");
    assert.equal(state.message, LIST_AUTH_NOTICE_COPY.mcp_tools);
    const html = renderTools(state);
    assert.match(html, /auth-required-notice/);
    assert.match(html, /Sign in to load MCP tools/);
    assert.doesNotMatch(html, /failure-banner|failure-retry/);
  });

  it("empty only on a successful zero-tool payload", async () => {
    const state = await loadMcpToolsList(async () => ({ tools: [] }));
    assert.deepEqual(state, { status: "ready", items: [] });
    const html = renderTools(state);
    assert.match(html, /data-testid="mcp-tools-list-empty"/);
    assert.match(html, new RegExp(MCP_TOOLS_EMPTY_COPY));
    assert.doesNotMatch(html, /failure-banner/);
  });

  it("loading copy is distinct from empty", () => {
    const html = renderTools({ status: "loading" });
    assert.match(html, new RegExp(MCP_TOOLS_LOADING_COPY));
    assert.doesNotMatch(html, new RegExp(MCP_TOOLS_EMPTY_COPY));
  });

  it("ready with tools renders no status row", async () => {
    const state = await loadMcpToolsList(async () => ({ tools: [sampleTool] }));
    assert.equal(renderTools(state), "");
  });
});

describe("PC approvals HTTP failure classification", () => {
  it("keeps auth, cross-site, storage, and generic forbidden distinct", async () => {
    const cases = [
      [401, { error: "Sign in is required." }, "auth_required"],
      [401, { code: "APPROVAL_STORAGE_UNAVAILABLE" }, "auth_required"],
      [403, { code: "FORBIDDEN_CROSS_SITE" }, "forbidden_cross_site"],
      [503, { code: "APPROVAL_STORAGE_UNAVAILABLE", error: "/var/task/private" }, "network_failure"],
      [403, { error: "ENOENT /var/task/private" }, "network_failure"],
      [403, { error: "Forbidden: cross-site request blocked" }, "network_failure"],
      [403, {}, "network_failure"],
    ] as const;
    for (const [status, body, kind] of cases) {
      const state = await loadPcApprovalsList(() => parsePcApprovalsResponse(new Response(JSON.stringify(body), { status })));
      assert.equal(state.status, "error");
      if (state.status !== "error") continue;
      assert.equal(state.kind, kind);
      assert.doesNotMatch(state.message, /var\/task|ENOENT|private/);
      if (body.code === "APPROVAL_STORAGE_UNAVAILABLE") assert.equal(state.message, PC_APPROVAL_STORAGE_FAILURE_COPY);
    }
  });

  it("malformed bodies are generic failures, never cross-site or empty success", async () => {
    for (const status of [200, 403, 503]) {
      const state = await loadPcApprovalsList(() => parsePcApprovalsResponse(new Response("<html>/var/task</html>", { status })));
      assert.equal(state.status, "error");
      if (state.status === "error") { assert.equal(state.kind, "network_failure"); assert.doesNotMatch(state.message, /var\/task|cross-site/i); }
    }
  });

  it("status-only and legacy filesystem errors do not imply cross-site", () => {
    for (const error of [httpError(403), httpError(403, "ENOENT: mkdir /var/task/.data")]) {
      const result = classifyListFailure(error, "pc_approvals");
      assert.equal(result.kind, "network_failure");
      assert.doesNotMatch(result.message, /cross-site|ENOENT|var\/task/i);
    }
  });
});

describe("PC approvals list: empty vs error", () => {
  it("rejected approvals fetch (401) is a dismissible notice, not 'nothing pending' and not a red Retry banner", async () => {
    const state = await loadPcApprovalsList(async () => {
      throw httpError(401);
    });
    assert.equal(state.status, "error");
    if (state.status !== "error") return;
    assert.equal(state.kind, "auth_required");
    assert.equal(state.message, LIST_AUTH_NOTICE_COPY.pc_approvals);
    const html = renderApprovals(state);
    assert.match(html, /auth-required-notice/);
    assert.match(html, /Sign in to load PC shell approvals/);
    assert.doesNotMatch(html, /failure-banner|failure-retry/);
    assert.doesNotMatch(html, /pc-approvals-list-empty|No pending PC shell approvals/);
  });

  it("empty only when ok:true and approvals:[]", async () => {
    const state = await loadPcApprovalsList(async () => ({ ok: true, approvals: [] }));
    assert.deepEqual(state, { status: "ready", items: [] });
    const html = renderApprovals(state);
    assert.match(html, /data-testid="pc-approvals-list-empty"/);
    assert.match(html, new RegExp(PC_APPROVALS_EMPTY_COPY));
    assert.doesNotMatch(html, /failure-banner/);
  });

  it("loading copy is distinct from empty", () => {
    const html = renderApprovals({ status: "loading" });
    assert.match(html, new RegExp(PC_APPROVALS_LOADING_COPY));
    assert.doesNotMatch(html, new RegExp(PC_APPROVALS_EMPTY_COPY));
  });

  it("ready with approvals renders no status row", async () => {
    const state = await loadPcApprovalsList(async () => ({ ok: true, approvals: [sampleApproval] }));
    assert.equal(renderApprovals(state), "");
  });

  it("HTTP 500 on approvals is an error, not empty", async () => {
    const state = await loadPcApprovalsList(async () => {
      throw httpError(500);
    });
    assert.equal(state.status, "error");
    const html = renderApprovals(state as FleetListState<PcApprovalRow>);
    assert.match(html, /failure-banner/);
  });
});

describe("MCP list Retry button", () => {
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
    const retry = onceListRetry(() => {
      pending.push(loadMcpList(fetcher));
    });
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


describe("Worker health status: offline vs load error", () => {
  it("rejected workerHealth shows the red banner, not muted offline copy", async () => {
    const state = await loadWorkerHealthStatus(async () => {
      throw httpError(500);
    });
    assert.equal(state.status, "error");
    if (state.status !== "error") return;
    assert.equal(state.kind, "network_failure");
    assert.match(state.message, /worker status could not be read/i);
    const html = renderWorkerHealth(state);
    assert.match(html, /failure-banner/);
    assert.match(html, /failure-retry/);
    assert.doesNotMatch(html, /Nothing is reported as online|No worker process is running/);
  });

  it("401 is auth_required notice, not offline and not a red Retry banner", async () => {
    const state = await loadWorkerHealthStatus(async () => {
      throw httpError(401, "Unauthorized");
    });
    assert.equal(state.status, "error");
    if (state.status !== "error") return;
    assert.equal(state.kind, "auth_required");
    assert.equal(state.message, LIST_AUTH_NOTICE_COPY.worker_health);
    const html = renderWorkerHealth(state);
    assert.match(html, /auth-required-notice/);
    assert.match(html, /Sign in to read worker status/);
    assert.doesNotMatch(html, /failure-banner|failure-retry/);
  });

  it("honest offline detail is ready, not an error banner", async () => {
    const state = await loadWorkerHealthStatus(async () => ({
      state: "offline",
      detail: "No worker process is running. Schedules stay saved. Nothing is running in the background.",
      localOnly: true,
      hosted: false,
    }));
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    assert.equal(state.health.state, "offline");
    assert.equal(renderWorkerHealth(state), "");
  });

  it("honest local worker detail is ready", async () => {
    const state = await loadWorkerHealthStatus(async () => ({
      state: "local",
      detail: "A local worker is polling this machine. It is not a hosted worker.",
      localOnly: true,
      hosted: false,
    }));
    assert.equal(state.status, "ready");
    assert.equal(renderWorkerHealth(state), "");
  });

  it("malformed payload is an error, not offline", async () => {
    const state = await loadWorkerHealthStatus(async () => ({ ok: true }));
    assert.equal(state.status, "error");
    const html = renderWorkerHealth(state as WorkerHealthState);
    assert.match(html, /failure-banner/);
    assert.match(html, /not JSON/);
  });

  it("hung probe times out into error and Retry can succeed", async () => {
    let calls = 0;
    const fetcher = () => {
      calls += 1;
      if (calls === 1) return new Promise(() => {});
      return Promise.resolve({
        state: "offline" as const,
        detail: "No worker process is running. Schedules stay saved. Nothing is running in the background.",
      });
    };
    let state = await loadWorkerHealthStatus(fetcher, { timeoutMs: 30 });
    assert.equal(state.status, "error");
    if (state.status === "error") assert.match(state.message, /timed out/i);
    const pending: Promise<WorkerHealthState>[] = [];
    const retry = onceListRetry(() => {
      pending.push(loadWorkerHealthStatus(fetcher, { timeoutMs: 30 }));
    });
    retry();
    retry();
    assert.equal(pending.length, 1);
    state = await pending[0];
    assert.equal(calls, 2);
    assert.equal(state.status, "ready");
  });

  it("loading copy is distinct from offline success copy", () => {
    const html = renderWorkerHealth({ status: "loading" });
    assert.match(html, new RegExp(WORKER_HEALTH_LOADING_COPY));
    assert.match(html, /worker-health-loading/);
    assert.doesNotMatch(html, /failure-banner|No worker process/);
  });

  it("Retry button in the worker health banner invokes the handler once", () => {
    let clicked = 0;
    const el = WorkerHealthStatusRows({
      state: { status: "error", kind: "network_failure", message: "x" },
      onRetry: onceListRetry(() => {
        clicked += 1;
      }),
    });
    const buttons = (el as unknown as { props: { children: unknown[] } }).props.children[1] as {
      props: { children: { props: { onClick: () => void } }[] };
    };
    buttons.props.children[0].props.onClick();
    buttons.props.children[0].props.onClick();
    assert.equal(clicked, 1);
  });
});
