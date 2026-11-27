import assert from "node:assert/strict";
import { test } from "node:test";
import { executeFleetGmail, type FleetAdapterDeps } from "./fleet-gmail.ts";
import type { ExternalFleetRequest } from "./fleet-external.ts";
import type { StoredConnection } from "./connectors/store.ts";

const connection: StoredConnection = { ownerId: "owner", connector: "gmail", accessTokenEnc: "fixture-encrypted", accountLabel: "owner@example.test", connectedAt: "2026-11-25T12:00:00.000Z", scopes: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send" };
const request: ExternalFleetRequest = { action: "gmail_send", runId: "run-fixture", stepId: "step-1", accountId: "owner@example.test", goal: "in:inbox", instructions: "", results: [], provider: null, modelTier: null, input: { accountId: "owner@example.test", connectionVersion: connection.connectedAt, recipients: ["recipient@example.test"], subject: "Hello", body: "Synthetic message" } };
function deps(fetcher: typeof fetch, stored = connection): FleetAdapterDeps { return { fetch: fetcher, connection: async () => stored, decrypt: () => "fake-token", env: {} }; }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }

test("Gmail adapter validates selected account and scope before dispatching, then binds provider acceptance to its ID", async () => {
  const calls: string[] = [];
  const result = await executeFleetGmail("owner", request, deps(async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith("/profile")) return json({ emailAddress: "owner@example.test" });
    assert.equal(String(url), "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    assert.equal(init!.redirect, "error");
    const mime = Buffer.from(JSON.parse(String(init!.body)).raw, "base64url").toString();
    assert.match(mime, /To: recipient@example\.test/);
    assert.match(mime, /Message-ID:/);
    return json({ id: "provider-message-1" });
  }));
  assert.equal(calls.length, 2);
  assert.ok(result.ok && "accountId" in result);
  assert.equal(result.accountId, "owner@example.test");
  assert.equal(result.operationId, "provider-message-1");
  assert.match(result.text, /not recipient delivery/);
});

test("a reconnect, account mismatch, missing scope, or different owner blocks before any network request", async () => {
  for (const change of [{ connectedAt: "2026-11-25T12:01:00.000Z" }, { accountLabel: "other@example.test" }, { scopes: "" }, { ownerId: "other-owner" }]) {
    let calls = 0;
    const result = await executeFleetGmail("owner", request, deps(async () => { calls++; return json({}); }, { ...connection, ...change }));
    assert.equal(calls, 0); assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.outcome, "not_sent");
  }
});

test("a token pointing to another Google account cannot send from the reviewed account", async () => {
  let calls = 0;
  const result = await executeFleetGmail("owner", request, deps(async () => { calls++; return json({ emailAddress: "other@example.test" }); }));
  assert.equal(calls, 1); assert.equal(result.ok, false);
});

test("send acknowledgment loss is unknown and never retried inside the adapter", async () => {
  let sends = 0;
  const result = await executeFleetGmail("owner", request, deps(async url => {
    if (String(url).endsWith("/profile")) return json({ emailAddress: "owner@example.test" });
    sends++; throw Error("lost response after provider accepted");
  }));
  assert.equal(sends, 1); assert.ok(!result.ok);
  assert.equal(result.outcome, "unknown");
});

test("header injection and malformed recipients fail without sending", async () => {
  for (const input of [{ ...request.input, subject: "Hello\r\nBcc: unintended@example.test" }, { ...request.input, recipients: ["a@example.test\r\nBcc: b@example.test"] }]) {
    let sends = 0;
    const result = await executeFleetGmail("owner", { ...request, input }, deps(async url => {
      if (String(url).endsWith("/profile")) return json({ emailAddress: "owner@example.test" });
      sends++; return json({ id: "must-not-send" });
    }));
    assert.equal(result.ok, false); assert.equal(sends, 0);
  }
});

test("read success with no messages remains an honest empty result", async () => {
  const result = await executeFleetGmail("owner", { ...request, action: "gmail_read" }, deps(async url => String(url).endsWith("/profile") ? json({ emailAddress: "owner@example.test" }) : json({ messages: [] })));
  assert.ok(result.ok); assert.match(result.text, /no matching messages/);
});

test("read extracts bounded previews and discloses further pages", async () => {
  const result = await executeFleetGmail("owner", { ...request, action: "gmail_read" }, deps(async url => {
    if (String(url).endsWith("/profile")) return json({ emailAddress: "owner@example.test" });
    if (String(url).includes("/messages?")) return json({ messages: [{ id: "msg-1" }], nextPageToken: "next" });
    return json({ id: "msg-1", snippet: "Fixture passage" });
  }));
  assert.ok(result.ok); assert.match(result.text, /Fixture passage/); assert.match(result.text, /not complete messages/); assert.match(result.text, /More results/);
});
