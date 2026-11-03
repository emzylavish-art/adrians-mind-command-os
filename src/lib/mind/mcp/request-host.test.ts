import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedRequestHosts,
  assertAllowedRequestHost,
  isAllowedRequestHost,
} from "./request-host.ts";
import { assertSameOrigin } from "../connectors/oauth-csrf.ts";
import { assertMcpHttpRequestGuards } from "./request-host.ts";

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers });
}

describe("inbound Host allowlist (DNS rebinding)", () => {
  const env = { MIND_ALLOWED_HOSTS: "app.example.com", BETTER_AUTH_URL: "https://auth.example.com" };

  it("allows loopback Host values used by local same-origin traffic", () => {
    for (const host of ["localhost:8080", "127.0.0.1:8080", "[::1]:8080"]) {
      const result = assertAllowedRequestHost(
        req(`http://${host}/api/mind/mcp/servers`, { host, origin: `http://${host}` }),
        env,
      );
      assert.equal(result.ok, true, host);
    }
  });

  it("rejects unexpected Host (classic DNS rebinding)", () => {
    const result = assertAllowedRequestHost(
      req("http://evil.example/api/mind/mcp/servers", {
        host: "evil.example",
        origin: "http://evil.example",
      }),
      env,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Host|rebinding/i);
  });

  it("rejects missing Host", () => {
    // Undici/Request always sets Host from URL in many runtimes; build via headers only.
    const request = new Request("http://127.0.0.1:8080/api/mind/mcp/servers", {
      method: "POST",
      headers: { host: "" },
    });
    // Empty host header string
    const result = assertAllowedRequestHost(request, env);
    // Some runtimes normalize empty Host away — still must not allow evil via allowlist miss
    if (request.headers.get("host")) {
      // if runtime kept a host from URL, that's fine if allowlisted
      assert.equal(isAllowedRequestHost(request.headers.get("host")!, allowedRequestHosts(env)), true);
    } else {
      assert.equal(result.ok, false);
    }
  });

  it("allows configured app host and BETTER_AUTH_URL host", () => {
    assert.equal(isAllowedRequestHost("app.example.com", allowedRequestHosts(env)), true);
    assert.equal(isAllowedRequestHost("auth.example.com", allowedRequestHosts(env)), true);
    assert.equal(
      assertAllowedRequestHost(
        req("https://app.example.com/api/mind/mcp/call", {
          host: "app.example.com",
          origin: "https://app.example.com",
        }),
        env,
      ).ok,
      true,
    );
  });

  it("allows preview wildcard hosts", () => {
    assert.equal(
      isAllowedRequestHost("abc123.grok-sandbox.com", allowedRequestHosts({})),
      true,
    );
    assert.equal(isAllowedRequestHost("evil.com", allowedRequestHosts({})), false);
  });

  it("rejects spoofed X-Forwarded-Host even when Host is allowlisted", () => {
    const result = assertAllowedRequestHost(
      req("http://127.0.0.1:8080/api/mind/mcp/servers", {
        host: "127.0.0.1:8080",
        "x-forwarded-host": "evil.example",
      }),
      env,
    );
    assert.equal(result.ok, false);
  });

  it("assertMcpHttpRequestGuards requires Host then same-origin", () => {
    const ok = assertMcpHttpRequestGuards(
      req("http://127.0.0.1:8080/api/mind/mcp/servers", {
        host: "127.0.0.1:8080",
        origin: "http://127.0.0.1:8080",
      }),
      assertSameOrigin,
      env,
    );
    assert.equal(ok.ok, true);

    const badHost = assertMcpHttpRequestGuards(
      req("http://evil.example/api/mind/mcp/servers", {
        host: "evil.example",
        origin: "http://evil.example",
      }),
      assertSameOrigin,
      env,
    );
    assert.equal(badHost.ok, false);

    const badOrigin = assertMcpHttpRequestGuards(
      req("http://127.0.0.1:8080/api/mind/mcp/servers", {
        host: "127.0.0.1:8080",
        origin: "https://evil.example",
      }),
      assertSameOrigin,
      env,
    );
    assert.equal(badOrigin.ok, false);
  });
});
