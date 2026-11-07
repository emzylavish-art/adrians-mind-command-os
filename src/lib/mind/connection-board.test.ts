import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { oauthBoardState } from "./connection-board.ts";

describe("oauth connection board", () => {
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
      "Connected",
    );
    assert.equal(oauthBoardState(null).state, "Status unavailable");
  });
});
