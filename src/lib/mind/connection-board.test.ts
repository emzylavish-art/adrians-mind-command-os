import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { oauthBoardState } from "./connection-board.ts";
import { ownerApiKind, ownerConnectTarget } from "./connection-board.ts";

describe("oauth connection board", () => {
  it("shows saved authorization, expiry and unresolved revocation as distinct states", () => {
    assert.equal(oauthBoardState({ state: "connected", detail: "saved", authorization: "expired" }).state, "Needs attention");
    assert.equal(oauthBoardState({ state: "not_connected", detail: "removed locally", recovery: { status: "revocation_unknown" } }).state, "Disconnected · review access");
    assert.equal(oauthBoardState({ state: "connected", detail: "saved" }).state, "Authorization saved");
  });
  it("does not let a legacy Connected flag override OAuth not_connected", () => {
    const board = oauthBoardState(
      { state: "not_connected", detail: "Gmail is not connected. Press Connect to start OAuth. No token is stored." },
      { state: "connected", detail: "Notion is connected on the server." },
    );
    assert.equal(board.state, "Not connected");
    assert.match(board.detail, /not connected/i);
    assert.equal(board.detail.includes("connected on the server"), false);
  });

  it("shows Gmail OAuth states from the status payload", () => {
    assert.equal(oauthBoardState(undefined).state, "Checking");
    assert.equal(
      oauthBoardState({ state: "not_configured", detail: "Gmail OAuth is not configured on the server." }).state,
      "Not configured",
    );
    assert.equal(
      oauthBoardState({ state: "connected", detail: "Connected to inbox. Tokens stay on the server." }).state,
      "Authorization saved",
    );
    assert.equal(oauthBoardState(null).state, "Status unavailable");
  });

  it("shows a server integration token when OAuth is not configured", () => {
    const board = oauthBoardState(
      { state: "not_configured", detail: "Notion OAuth is not configured." },
      { state: "connected", detail: "Notion is connected on the server. The secret is not shown." },
    );
    assert.equal(board.state, "API token present");
    assert.match(board.detail, /not an OAuth session/);
    assert.equal(board.detail.includes("secret_"), false);
  });

  it("sends API and MCP setup to a paste form, and leaves Slack without one", () => {
    assert.equal(ownerConnectTarget("OpenAI"), "api");
    assert.equal(ownerConnectTarget("Claude"), "api");
    assert.equal(ownerApiKind("Gemini"), "gemini");
    assert.equal(ownerConnectTarget("MCP"), "mcp");
    assert.equal(ownerConnectTarget("Slack"), null);
  });
});
