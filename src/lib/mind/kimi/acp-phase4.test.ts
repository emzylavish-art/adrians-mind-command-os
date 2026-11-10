import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryInitializeCapabilities,
  mapApprovedMcpServers,
  normalizeSessionUpdate,
  type PublicMcpServer,
} from "./acp-phase4.ts";

test("initialize inventory distinguishes reported support from unknown support", () => {
  const unknown = inventoryInitializeCapabilities({ agentInfo: { name: "Kimi", version: "1.2.3" } });
  assert.equal(unknown.evidence, "missing_initialize_capabilities");
  assert.equal(unknown.sessionMethods.fork, "unknown");
  assert.deepEqual(unknown.flags, []);

  const inventory = inventoryInitializeCapabilities({
    agentInfo: { name: "Kimi", version: "1.2.3", token: "do-not-copy" },
    agentCapabilities: {
      fs: { readTextFile: true, writeTextFile: false },
      terminal: false,
      supportedMethods: ["session/load"],
    },
  });
  assert.deepEqual(inventory.agent, { name: "Kimi", version: "1.2.3" });
  assert.deepEqual(inventory.flags, [
    { path: "fs.readTextFile", state: "advertised" },
    { path: "fs.writeTextFile", state: "not_advertised" },
    { path: "terminal", state: "not_advertised" },
  ]);
  assert.equal(inventory.sessionMethods.load, "advertised");
  assert.equal(inventory.sessionMethods.fork, "not_advertised");
});

test("initialize inventory is bounded and never exposes arbitrary capability values", () => {
  const nested = Object.fromEntries(Array.from({ length: 140 }, (_, index) => [`cap${index}`, true]));
  const inventory = inventoryInitializeCapabilities({ agentCapabilities: nested });
  assert.equal(inventory.flags.length, 100);
  assert.equal(JSON.stringify(inventory).includes("private value"), false);
});

test("assistant text chunks are surfaced with credential-like strings redacted", () => {
  const event = normalizeSessionUpdate({ update: {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Done. Bearer abc123 api_key=secret-value" },
  } });
  assert.equal(event?.kind, "assistant_message");
  assert.equal(event?.text, "Done. Bearer [REDACTED] api_key=[REDACTED]");
});

test("tool lifecycle is summarized without forwarding arguments or result payloads", () => {
  const event = normalizeSessionUpdate({ update: {
    sessionUpdate: "tool_call_update",
    toolCallId: "call-7",
    title: "Reading project files",
    status: "completed",
    rawInput: { token: "secret" },
    content: [{ type: "text", text: "sensitive output" }],
  } });
  assert.deepEqual(event, {
    kind: "tool_call_update",
    updateType: "tool_call_update",
    summary: "Tool call status updated",
    callId: "call-7",
    title: "Reading project files",
    status: "completed",
  });
});

test("plan events report counts only and private reasoning updates are suppressed", () => {
  const plan = normalizeSessionUpdate({ sessionUpdate: "plan", entries: [
    { status: "completed", content: "private chain text" },
    { status: "running", content: "another private string" },
  ] });
  assert.deepEqual(plan, {
    kind: "plan_progress",
    updateType: "plan",
    summary: "Plan progress updated",
    planStepCount: 2,
    completedStepCount: 1,
  });
  assert.equal(normalizeSessionUpdate({ sessionUpdate: "agent_reasoning", text: "do not show" }), null);
  assert.equal(normalizeSessionUpdate({ sessionUpdate: "agent_thought", text: "do not show" }), null);
});

test("unknown ACP updates expose only a bounded type, not their raw payload", () => {
  const event = normalizeSessionUpdate({ sessionUpdate: "new_runtime_update", arbitrary: "secret" });
  assert.deepEqual(event, {
    kind: "unknown_update",
    updateType: "new_runtime_update",
    summary: "Unrecognized ACP update received",
  });
});

test("MCP mapping requires explicit approval, enabled state, stdio command allowlist, and no unresolved secrets", () => {
  const entries: PublicMcpServer[] = [
    { id: "stdio-ok", label: "Safe server", kind: "command", enabled: true, command: "mcp-safe", args: ["--stdio"] },
    { id: "http", label: "HTTP server", kind: "http", enabled: true, command: "ignored" },
    { id: "disabled", label: "Disabled", kind: "command", enabled: false, command: "mcp-safe" },
    { id: "needs-approval", label: "Needs approval", kind: "command", enabled: true, command: "mcp-safe" },
    { id: "secret-env", label: "Secret env", kind: "command", enabled: true, command: "mcp-safe", envKeys: ["API_TOKEN"] },
    { id: "untrusted", label: "Untrusted", kind: "command", enabled: true, command: "other-command" },
  ];
  const result = mapApprovedMcpServers(entries, {
    approvedServerIds: new Set(["stdio-ok", "http", "disabled", "secret-env", "untrusted"]),
    allowedCommands: new Set(["mcp-safe"]),
    verifiedTransports: new Set(["stdio"]),
  });
  assert.deepEqual(result.servers, [{ name: "stdio-ok", command: "mcp-safe", args: ["--stdio"] }]);
  assert.deepEqual(result.decisions.map(({ serverId, state }) => [serverId, state]), [
    ["stdio-ok", "mapped"],
    ["http", "transport_unverified"],
    ["disabled", "disabled"],
    ["needs-approval", "approval_required"],
    ["secret-env", "secret_injection_unavailable"],
    ["untrusted", "command_not_allowlisted"],
  ]);
});

test("MCP arguments containing credential material are refused", () => {
  const result = mapApprovedMcpServers([
    { id: "leak", label: "Leak", kind: "command", enabled: true, command: "mcp-safe", args: ["--token=secret"] },
  ], { approvedServerIds: new Set(["leak"]), allowedCommands: new Set(["mcp-safe"]), verifiedTransports: new Set(["stdio"]) });
  assert.deepEqual(result.servers, []);
  assert.deepEqual(result.decisions, [{ serverId: "leak", state: "secret_injection_unavailable" }]);
});

test("MCP stdio is not emitted until the ACP transport contract is verified", () => {
  const result = mapApprovedMcpServers([
    { id: "stdio", label: "Server", kind: "command", enabled: true, command: "mcp-safe" },
  ], { approvedServerIds: new Set(["stdio"]), allowedCommands: new Set(["mcp-safe"]), verifiedTransports: new Set() });
  assert.deepEqual(result.servers, []);
  assert.deepEqual(result.decisions, [{ serverId: "stdio", state: "transport_unverified" }]);
});
