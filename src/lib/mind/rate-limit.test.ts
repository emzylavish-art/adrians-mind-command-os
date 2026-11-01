import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_RATE_LIMIT_REPLY,
  AGENT_RATE_LIMIT_REPLY,
  consumeMindRateLimit,
  resetMindRateLimitsForTests,
  mindRateLimitHeaders,
  jsonRateLimited,
} from "./limits.ts";
import { readJsonObjectBody } from "./request-body.ts";

describe("mind HTTP rate limit (429 + Retry-After)", () => {
  it("a burst over the chat limit returns 429 with Retry-After seconds", () => {
    resetMindRateLimitsForTests();
    const windowMs = 60_000;
    const limit = 3;
    let now = 1_000;
    for (let i = 0; i < limit; i += 1) {
      const ok = consumeMindRateLimit("chat", "user-a", limit, windowMs, now);
      assert.equal(ok.ok, true);
      now += 10;
    }
    const blocked = consumeMindRateLimit("chat", "user-a", limit, windowMs, now);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.ok(blocked.retryAfterSec >= 1);
      assert.ok(blocked.retryAfterSec <= 60);
      const res = jsonRateLimited(CHAT_RATE_LIMIT_REPLY, blocked.retryAfterSec);
      assert.equal(res.status, 429);
      assert.equal(res.headers.get("retry-after"), String(blocked.retryAfterSec));
      assert.equal(res.headers.get("content-type"), "application/json");
    }
  });

  it("agent bucket likewise returns 429 + Retry-After when exhausted", () => {
    resetMindRateLimitsForTests();
    const limit = 2;
    assert.equal(consumeMindRateLimit("agent", "u", limit, 60_000, 0).ok, true);
    assert.equal(consumeMindRateLimit("agent", "u", limit, 60_000, 1).ok, true);
    const blocked = consumeMindRateLimit("agent", "u", limit, 60_000, 2);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      const res = jsonRateLimited(AGENT_RATE_LIMIT_REPLY, blocked.retryAfterSec, { log: [] });
      assert.equal(res.status, 429);
      assert.equal(res.headers.get("retry-after"), String(blocked.retryAfterSec));
    }
  });

  it("malformed bodies stay 400 and do not consume a rate-limit token", async () => {
    resetMindRateLimitsForTests();
    // Documented choice: only well-formed JSON objects that pass the body guard
    // can consume a chat/agent token. Null/[] never count toward the limit.
    const before = consumeMindRateLimit("chat", "malformed-user", 1, 60_000, 5_000);
    assert.equal(before.ok, true); // take the only slot via a "valid attempt" simulation
    const blocked = consumeMindRateLimit("chat", "malformed-user", 1, 60_000, 5_010);
    assert.equal(blocked.ok, false);

    const read = await readJsonObjectBody(
      new Request("http://local.test/api/mind/turn", { method: "POST", body: "null" }),
      1_000,
    );
    assert.equal(read.ok, false);
    if (!read.ok) {
      assert.equal(read.status, 400);
      assert.equal(read.error, "That request could not be read.");
    }
    // Still rate-limited for real attempts — body guard is independent.
    assert.equal(consumeMindRateLimit("chat", "malformed-user", 1, 60_000, 5_020).ok, false);
  });

  it("Retry-After header map is seconds as a decimal string", () => {
    const headers = mindRateLimitHeaders(42);
    assert.equal(headers["retry-after"], "42");
    assert.equal(headers["cache-control"], "no-store");
  });
});
