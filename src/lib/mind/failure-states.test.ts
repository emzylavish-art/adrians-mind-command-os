import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_DISCONNECT_REPLY,
  CHAT_TIMEOUT_REPLY,
  HONEST_FAILURE_MESSAGES,
  STOPPED_REPLY,
  bindRetry,
  classifyHonestFailure,
  classifyHonestTurnOutcome,
  failureBannerMountHint,
  honestFailureAuditAction,
  honestFailureDescription,
  honestTurnAuditAction,
  isUserStoppedReply,
  mcpToolFailure,
  normalizeClientFailureMessage,
  imageGenerationFailure,
  imagineRetryParams,
  mapImagineHttpErrorCopy,
  shouldShowFailureBanner,
} from "./failure-states.ts";

describe("honest failure states", () => {
  it("classifies the three defined states from existing copy", () => {
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.emergency_stop_active), "emergency_stop_active");
    assert.equal(classifyHonestFailure("Emergency stop is on. Inspection is blocked."), "emergency_stop_active");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.database_write_failed), "database_write_failed");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.model_unavailable), "model_unavailable");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.model_unreachable), "model_unavailable");
    assert.equal(classifyHonestFailure("No Grok key is configured on the server. Another provider is not substituted."), "model_unavailable");
    assert.equal(classifyHonestFailure("Sign in is required."), "auth_required");
  });

  it("keeps one-line descriptions and audit action names stable", () => {
    assert.equal(honestFailureDescription("emergency_stop_active"), HONEST_FAILURE_MESSAGES.emergency_stop_active);
    assert.equal(honestFailureDescription("database_write_failed"), HONEST_FAILURE_MESSAGES.database_write_failed);
    assert.equal(honestFailureDescription("model_unavailable", "custom"), "custom");
    assert.equal(honestFailureAuditAction("model_unavailable"), "model_unavailable");
    assert.equal(honestFailureAuditAction("database_write_failed"), "database_write_failed");
    assert.equal(honestFailureAuditAction("emergency_stop_active"), "emergency_stop_active");
  });

  it("retries with identical parameters", () => {
    const calls: Array<[string, number]> = [];
    const retry = bindRetry((query: string, limit: number) => {
      calls.push([query, limit]);
    }, ["harbor dredge", 3] as [string, number]);
    retry();
    retry();
    assert.deepEqual(calls, [
      ["harbor dredge", 3],
      ["harbor dredge", 3],
    ]);
  });

  it("banner 5: classifies MCP tool-call failure copy from the MCP integration", () => {
    for (const message of [
      "The MCP server could not be reached.",
      "The MCP server returned 502. Nothing was called.",
      "The MCP server did not return a JSON-RPC result.",
      "The MCP server returned no text. Nothing was invented.",
      "That MCP server is not registered. Nothing was called.",
      "MCP server “Docs” is disabled. Nothing was called.",
      "Unknown built-in tool “nope”. Nothing was called.",
      "No paired PC online. Nothing ran on a laptop or phone.",
      "PGLite query error: relation does not exist",
      HONEST_FAILURE_MESSAGES.mcp_tool_failed,
      HONEST_FAILURE_MESSAGES.mcp_unreachable,
    ]) {
      assert.equal(classifyHonestFailure(message), "mcp_tool_failed", message);
    }
    // Earlier states keep priority and are not swallowed.
    assert.equal(classifyHonestFailure("Emergency stop is on. Nothing was called."), "emergency_stop_active");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.model_unreachable), "model_unavailable");
    assert.equal(honestFailureAuditAction("mcp_tool_failed"), "mcp_tool_failed");
    assert.equal(honestFailureDescription("mcp_tool_failed"), HONEST_FAILURE_MESSAGES.mcp_tool_failed);
  });

  it("banner 5: builds a one-line description from an MCP tool-call result", () => {
    assert.equal(mcpToolFailure({ ok: true, status: "ok", text: "1" }), null);
    assert.equal(mcpToolFailure({ ok: false, needsConfirmation: true, error: "Call “x” on Docs only after you confirm. Nothing was called." }), null);
    assert.equal(mcpToolFailure({ ok: false, status: "running" }), null);
    const registry = mcpToolFailure({
      ok: false,
      status: "error",
      serverId: "builtin",
      tool: "pglite_query",
      text: "PGLite query error:\n relation   \"x\" does not exist",
    });
    assert.deepEqual(registry, {
      kind: "mcp_tool_failed",
      message: "MCP tool “pglite_query” failed. PGLite query error: relation \"x\" does not exist",
      target: "mcp:builtin/pglite_query",
    });
    assert.ok(!registry!.message.includes("\n"));
    assert.equal(classifyHonestFailure(registry!.message), "mcp_tool_failed");
    const command = mcpToolFailure({ ok: false, error: "The MCP server returned 500. Nothing was called.", text: "" });
    assert.deepEqual(command, { kind: "mcp_tool_failed", message: "The MCP server returned 500. Nothing was called.", target: "mcp" });
    const bare = mcpToolFailure({ ok: false, status: "error" });
    assert.equal(bare?.message, HONEST_FAILURE_MESSAGES.mcp_tool_failed);
    const isError = mcpToolFailure({ ok: true, status: "error", tool: "notion_read", serverId: "builtin", text: "Notion returned 401. Nothing was invented." });
    assert.equal(isError?.message, "MCP tool “notion_read” failed. Notion returned 401. Nothing was invented.");
  });

  it("banner 5: retry re-runs the same MCP call with identical parameters", () => {
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    const args = { sql: "SELECT 1" };
    const retry = bindRetry((serverId: string, tool: string, input: Record<string, unknown>) => {
      calls.push([serverId, tool, input]);
    }, ["builtin", "pglite_query", args] as [string, string, Record<string, unknown>]);
    retry();
    retry();
    assert.deepEqual(calls, [
      ["builtin", "pglite_query", { sql: "SELECT 1" }],
      ["builtin", "pglite_query", { sql: "SELECT 1" }],
    ]);
    assert.equal(calls[0][2], args);
    assert.equal(calls[1][2], args);
  });
});


describe("top-5 gap classifiers", () => {
  it("recognizes CHAT_TIMEOUT_REPLY and stale timeout markers as chat_timeout, not model_unavailable", () => {
    assert.equal(classifyHonestFailure(CHAT_TIMEOUT_REPLY), "chat_timeout");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.chat_timeout_stale), "chat_timeout");
    assert.equal(classifyHonestFailure("Grok did not answer in time"), "chat_timeout");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.model_unreachable), "model_unavailable");
    assert.equal(honestFailureAuditAction("chat_timeout"), "chat_timeout");
    assert.equal(honestFailureDescription("chat_timeout"), CHAT_TIMEOUT_REPLY);
  });

  it("recognizes network, offline, and Failed to fetch as network_failure", () => {
    assert.equal(classifyHonestFailure("Failed to fetch"), "network_failure");
    assert.equal(classifyHonestFailure(CHAT_DISCONNECT_REPLY), "network_failure");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.network_offline), "network_failure");
    assert.equal(classifyHonestFailure("TypeError: NetworkError when attempting to fetch resource."), "network_failure");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.mcp_list_failed), "network_failure");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.mcp_tools_list_failed), "network_failure");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.pc_approvals_list_failed), "network_failure");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.worker_health_failed), "network_failure");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.pc_approve_failed), "network_failure");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.pc_deny_failed), "network_failure");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.mcp_try_select_failed), "network_failure");
    assert.equal(classifyHonestFailure("The worker status could not be read. The network request failed. Nothing was substituted."), "network_failure");
    assert.equal(honestFailureAuditAction("network_failure"), "network_failure");
  });

  it("recognizes 401 sign-in and 403 cross-site with server copy", () => {
    assert.equal(classifyHonestFailure("Sign in is required."), "auth_required");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.auth_required), "auth_required");
    assert.equal(classifyHonestFailure("Forbidden: cross-site request blocked"), "forbidden_cross_site");
    assert.equal(honestFailureDescription("auth_required"), "Sign in is required.");
    assert.equal(honestFailureDescription("forbidden_cross_site"), "Forbidden: cross-site request blocked");
    assert.equal(honestFailureAuditAction("auth_required"), "auth_required");
    assert.equal(honestFailureAuditAction("forbidden_cross_site"), "forbidden_cross_site");
  });

  it("recognizes provider 429 rate limit copy", () => {
    assert.equal(
      classifyHonestFailure("grok rate limited the request. Nothing was substituted."),
      "rate_limited",
    );
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.rate_limited), "rate_limited");
    assert.equal(honestFailureAuditAction("rate_limited"), "rate_limited");
  });

  it("normalizes caught client errors into honest copy for Retry banners", () => {
    assert.equal(normalizeClientFailureMessage(new Error("Unauthorized")), "Sign in is required.");
    assert.equal(normalizeClientFailureMessage(new TypeError("Failed to fetch")), "Failed to fetch");
    assert.equal(
      normalizeClientFailureMessage(new Error("Forbidden: cross-site request blocked")),
      "Forbidden: cross-site request blocked",
    );
    assert.match(normalizeClientFailureMessage(new Error("xai rate limited the request. Nothing was substituted.")), /rate limited/);
  });

  it("retries MCP list load with identical action via bindRetry", () => {
    const calls: string[] = [];
    const load = () => calls.push("load");
    const retry = bindRetry(load, [] as []);
    retry();
    retry();
    assert.deepEqual(calls, ["load", "load"]);
  });
});


describe("banner 4 image_generation_failed", () => {
  it("classifies mapImagineHttpError copy as image_generation_failed", () => {
    for (const message of [
      HONEST_FAILURE_MESSAGES.image_generation_failed,
      HONEST_FAILURE_MESSAGES.image_generation_refused,
      HONEST_FAILURE_MESSAGES.image_generation_rate_limited,
      HONEST_FAILURE_MESSAGES.image_generation_moderation,
      HONEST_FAILURE_MESSAGES.image_generation_invalid,
      HONEST_FAILURE_MESSAGES.image_generation_too_large,
      HONEST_FAILURE_MESSAGES.image_generation_timeout,
      "Image generation failed (HTTP 502).",
      "Imagine failed (HTTP 500).",
      "Edit with Imagine failed (HTTP 503).",
      "Imagine could not be reached.",
    ]) {
      assert.equal(classifyHonestFailure(message), "image_generation_failed", message);
    }
    assert.equal(honestFailureAuditAction("image_generation_failed"), "image_generation_failed");
    assert.equal(honestFailureDescription("image_generation_failed"), HONEST_FAILURE_MESSAGES.image_generation_failed);
  });

  it("keeps one-line mapImagineHttpError copy for the banner description", () => {
    assert.equal(mapImagineHttpErrorCopy(429, "slow down"), HONEST_FAILURE_MESSAGES.image_generation_rate_limited);
    assert.equal(mapImagineHttpErrorCopy(400, "content moderation policy"), HONEST_FAILURE_MESSAGES.image_generation_moderation);
    assert.equal(mapImagineHttpErrorCopy(503, ""), HONEST_FAILURE_MESSAGES.image_generation_failed);
    assert.equal(mapImagineHttpErrorCopy(401, "nope"), HONEST_FAILURE_MESSAGES.image_generation_refused);
    const built = imageGenerationFailure({
      mode: "generate",
      prompt: "a red lighthouse",
      status: 503,
      serverError: "internal stack trace secret",
    });
    assert.equal(built.kind, "image_generation_failed");
    assert.equal(built.message, HONEST_FAILURE_MESSAGES.image_generation_failed);
    assert.ok(!built.message.includes("\n"));
    assert.ok(!built.message.includes("secret"));
    assert.equal(built.prompt, "a red lighthouse");
    assert.equal(built.n, 1);
  });

  it("Retry re-runs Imagine with identical prompt, options, and edit source image", () => {
    const calls: Array<ReturnType<typeof imagineRetryParams>> = [];
    const failure = imageGenerationFailure({
      mode: "edit",
      prompt: "make it dusk",
      status: 500,
      imageDataUrl: "data:image/png;base64,aaa",
      n: 1,
    });
    const params = imagineRetryParams(failure);
    const retry = bindRetry((p: typeof params) => {
      calls.push(p);
    }, [params] as [typeof params]);
    retry();
    retry();
    assert.deepEqual(calls, [params, params]);
    assert.equal(calls[0], params);
    assert.equal(calls[0].prompt, "make it dusk");
    assert.equal(calls[0].imageDataUrl, "data:image/png;base64,aaa");
    assert.equal(calls[0].mode, "edit");
    assert.equal(calls[0].n, 1);
  });

  it("generate Retry keeps identical prompt and n without inventing an image", () => {
    const failure = imageGenerationFailure({ mode: "generate", prompt: "harbor at dawn", status: 429, serverError: "rate", n: 1 });
    const params = imagineRetryParams(failure);
    assert.deepEqual(params, { mode: "generate", prompt: "harbor at dawn", n: 1 });
    assert.equal("imageDataUrl" in params, false);
  });
});

describe("H22 intentional STOPPED_REPLY vs failure banners", () => {
  it("STOPPED_REPLY is user_stopped, not chat_failed and not an honest failure kind", () => {
    assert.equal(STOPPED_REPLY, "Stopped. The unfinished reply was not saved.");
    assert.equal(isUserStoppedReply(STOPPED_REPLY), true);
    assert.equal(classifyHonestFailure(STOPPED_REPLY), null);
    assert.equal(classifyHonestTurnOutcome(STOPPED_REPLY), "user_stopped");
    assert.equal(honestTurnAuditAction(STOPPED_REPLY), "user_stopped");
    assert.notEqual(honestTurnAuditAction(STOPPED_REPLY), "chat_failed");
  });

  it("intentional stop must not show the red failure banner", () => {
    assert.equal(shouldShowFailureBanner(STOPPED_REPLY), false);
    assert.equal(shouldShowFailureBanner(`  ${STOPPED_REPLY}  `), false);
  });

  it("timeouts and disconnects still classify as failures with banners", () => {
    assert.equal(classifyHonestTurnOutcome(CHAT_TIMEOUT_REPLY), "chat_timeout");
    assert.equal(shouldShowFailureBanner(CHAT_TIMEOUT_REPLY), true);
    assert.equal(classifyHonestFailure(CHAT_TIMEOUT_REPLY), "chat_timeout");
    assert.equal(classifyHonestTurnOutcome(CHAT_DISCONNECT_REPLY), "network_failure");
    assert.equal(shouldShowFailureBanner(CHAT_DISCONNECT_REPLY), true);
    assert.equal(classifyHonestFailure("Failed to fetch"), "network_failure");
    assert.equal(shouldShowFailureBanner("Failed to fetch"), true);
    assert.equal(classifyHonestTurnOutcome(HONEST_FAILURE_MESSAGES.chat_timeout_stale), "chat_timeout");
  });

  it("agent budget stop is not an intentional user stop", () => {
    const agentStop = "Stopped after 8 tool steps.";
    assert.equal(isUserStoppedReply(agentStop), false);
    assert.equal(classifyHonestTurnOutcome(agentStop), null);
    assert.equal(shouldShowFailureBanner(agentStop), true);
    assert.equal(honestTurnAuditAction(agentStop), null);
  });

  it("provider close without abort stays a bannerable failure path (unclassified or model)", () => {
    const closed = "Grok closed the reply before it finished. Nothing was saved as a success.";
    assert.equal(isUserStoppedReply(closed), false);
    assert.equal(shouldShowFailureBanner(closed), true);
  });

  it("exports a one-line mount hint for command-app without editing it here", () => {
    assert.match(failureBannerMountHint(), /shouldShowFailureBanner/);
    assert.match(failureBannerMountHint(), /reportFailure/);
  });
});
