import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  callProvenance,
  isKnownReadSafe,
  missingConfigNotice,
  safeReason,
  timeoutRetryDecision,
} from "./call-contract.ts";
import { acceptResult, dismissResult, startAttempt } from "../../../components/mind/custom-connection-result.ts";

const SECRET = "sekret-value";

describe("five acceptance answers", () => {
  it("1 safeReason is one line and drops credentials, headers, urls, and payload fields", () => {
    const raw = `line one ${SECRET}\nAuthorization: Bearer ${SECRET}\nhttps://mcp.example/x?token=${SECRET}\n{"password":"other-secret","token":"${SECRET}"}`;
    const reason = safeReason(raw, SECRET);
    assert.equal(reason.includes("\n"), false);
    assert.equal(reason.includes(SECRET), false);
    assert.equal(reason.includes("other-secret"), false);
    assert.equal(reason.includes("mcp.example"), false);
    assert.match(reason, /\[redacted\]/);
    assert.match(reason, /\[url\]/);
  });

  it("2 local attempt id is not an upstream request id", () => {
    const started = startAttempt("local-1");
    const provenance = callProvenance(started.localAttemptId);
    assert.equal(provenance.localAttemptId, "local-1");
    assert.equal(provenance.upstreamRequestId, null);
    const shown = acceptResult("local-1", { localAttemptId: "local-1", status: "error", text: "x-request-id: up-9" });
    assert.notEqual(shown, "stale");
    if (shown === "stale") return;
    assert.equal(shown.localAttemptId, "local-1");
    assert.equal(shown.upstreamRequestId, null);
    assert.equal(JSON.stringify(shown).includes('"upstreamRequestId":"up-9"'), false);
  });

  it("3 missing database and missing token are not configured and are not retried", () => {
    const database = missingConfigNotice({ text: "No durable database is configured (DATABASE_URL or POSTGRES_URL). Nothing was saved." });
    const token = missingConfigNotice({ code: "missing_config", text: "CONNECTOR_TOKEN_SECRET is not set. Tokens cannot be stored encrypted. Nothing was saved." });
    assert.deepEqual(database, { copy: "Not configured. Nothing was retried.", retryable: false });
    assert.deepEqual(token, { copy: "Not configured. Nothing was retried.", retryable: false });
    assert.equal(missingConfigNotice({ text: "The MCP server returned 500." }), null);
  });

  it("4 a timeout does not retry writes, and only the allowlist is read-safe", () => {
    assert.equal(isKnownReadSafe({ kind: "http", method: "GET", tool: "request" }), true);
    assert.equal(isKnownReadSafe({ kind: "mcp", tool: "pglite_list_schema" }), true);
    assert.equal(isKnownReadSafe({ kind: "http", method: "POST", tool: "request" }), false);
    assert.equal(isKnownReadSafe({ kind: "mcp", tool: "tools/call" }), false);
    assert.deepEqual(timeoutRetryDecision({ code: "timeout", readSafe: false }), { retryable: false, autoRetried: false });
    assert.deepEqual(timeoutRetryDecision({ code: "timeout", readSafe: true }), { retryable: false, autoRetried: false });
  });

  it("5 repeated click, dismiss, and a stale error do not replace a later success", () => {
    const first = startAttempt("click-1");
    const second = startAttempt("click-2");
    assert.notEqual(first.localAttemptId, second.localAttemptId);
    const lateError = acceptResult(second.localAttemptId, { localAttemptId: first.localAttemptId, status: "error", text: "old failure" });
    assert.equal(lateError, "stale");
    const success = acceptResult(second.localAttemptId, { localAttemptId: second.localAttemptId, status: "ok", text: "status:7" });
    assert.notEqual(success, "stale");
    if (success === "stale") return;
    assert.equal(success.status, "ok");
    assert.equal(success.text, "status:7");
    assert.equal(success.retryable, false);
    assert.equal(dismissResult(), null);
  });
});
