import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
import {
  OAUTH_STATUS_FETCH_TIMEOUT_MS,
  STATUS_UNAVAILABLE_DETAIL,
  STATUS_UNAVAILABLE_SIGNIN_DETAIL,
  fetchOauthStatusPayload,
  isStatusUnavailable,
  unavailableStatus,
} from "./service-board-status.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(status: number, body: string, contentType = "text/plain"): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

describe("service-board oauth status resolution", () => {
  it("reuses the connector readiness probe timeout (10s)", () => {
    assert.equal(OAUTH_STATUS_FETCH_TIMEOUT_MS, 10_000);
  });

  it("401 → Status unavailable (sign-in copy, matches MCP 02b2703)", async () => {
    const status = await fetchOauthStatusPayload("/api/mind/oauth/github/status", {
      fetchFn: async () => jsonResponse(401, { ok: false, error: "Sign in is required." }),
    });
    assert.equal(status.state, "unavailable");
    assert.equal(status.detail, STATUS_UNAVAILABLE_SIGNIN_DETAIL);
    assert.equal(isStatusUnavailable(status), true);
  });

  it("403 → Status unavailable", async () => {
    const status = await fetchOauthStatusPayload("/api/mind/oauth/gmail/status", {
      fetchFn: async () => jsonResponse(403, { ok: false, error: "Forbidden" }),
    });
    assert.equal(status.detail, STATUS_UNAVAILABLE_SIGNIN_DETAIL);
    assert.equal(isStatusUnavailable(status), true);
  });

  it("500 → Status unavailable", async () => {
    const status = await fetchOauthStatusPayload("/api/mind/oauth/slack/status", {
      fetchFn: async () => jsonResponse(500, { ok: false, error: "boom" }),
    });
    assert.equal(status.detail, STATUS_UNAVAILABLE_DETAIL);
    assert.equal(isStatusUnavailable(status), true);
  });

  it("network rejection → Status unavailable", async () => {
    const status = await fetchOauthStatusPayload("/api/mind/oauth/google_drive/status", {
      fetchFn: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    assert.equal(status.detail, STATUS_UNAVAILABLE_DETAIL);
    assert.equal(isStatusUnavailable(status), true);
  });

  it("hang hits timeout → Status unavailable", async () => {
    const status = await fetchOauthStatusPayload("/api/mind/oauth/google_calendar/status", {
      timeoutMs: 40,
      fetchFn: async (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          const onAbort = () => reject(new DOMException("The operation timed out", "TimeoutError"));
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }),
    });
    assert.equal(status.detail, STATUS_UNAVAILABLE_DETAIL);
    assert.equal(isStatusUnavailable(status), true);
  });

  it("non-JSON body → Status unavailable", async () => {
    const status = await fetchOauthStatusPayload("/api/mind/oauth/notion/status", {
      fetchFn: async () => textResponse(200, "<html>nope</html>", "text/html"),
    });
    assert.equal(status.detail, STATUS_UNAVAILABLE_DETAIL);
    assert.equal(isStatusUnavailable(status), true);
  });

  it("Retry succeeding: unavailable then ok connected", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(500, { ok: false, error: "down" });
      return jsonResponse(200, {
        ok: true,
        state: "connected",
        detail: "GitHub is connected.",
        accountLabel: "octocat",
      });
    };
    const first = await fetchOauthStatusPayload("/status", { fetchFn });
    assert.equal(isStatusUnavailable(first), true);
    const second = await fetchOauthStatusPayload("/status", { fetchFn });
    assert.equal(second.state, "connected");
    assert.equal(isStatusUnavailable(second), false);
    assert.equal(calls, 2);
  });

  it("successful not_configured stays Not configured (not Checking…)", async () => {
    const status = await fetchOauthStatusPayload("/status", {
      fetchFn: async () =>
        jsonResponse(200, {
          state: "not_configured",
          detail: "No API key.",
        }),
    });
    assert.equal(status.state, "not_configured");
    assert.equal(status.detail, "No API key.");
    assert.equal(isStatusUnavailable(status), false);
  });

  it("MCP 02b2703 not_connected + could-not-be-read detail still counts as unavailable for Retry", () => {
    const mcpShape = { state: "not_connected", detail: STATUS_UNAVAILABLE_DETAIL };
    assert.equal(isStatusUnavailable(mcpShape), true);
    assert.equal(unavailableStatus(401).detail, STATUS_UNAVAILABLE_SIGNIN_DETAIL);
  });

  it("card-sized red unavailable strip matches failure-banner cues + Retry", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        {
          className: "mt-3 flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-3 py-2",
          role: "alert",
          "data-testid": "connector-status-unavailable",
        },
        createElement("p", { className: "text-sm text-danger" }, STATUS_UNAVAILABLE_DETAIL),
        createElement(
          "button",
          {
            type: "button",
            "data-testid": "connector-status-retry",
          },
          "Retry",
        ),
      ),
    );
    assert.match(html, /role="alert"/);
    assert.match(html, /border-danger\/40/);
    assert.match(html, /bg-danger\/10/);
    assert.match(html, /text-danger/);
    assert.match(html, /data-testid="connector-status-unavailable"/);
    assert.match(html, /data-testid="connector-status-retry"/);
    assert.match(html, />Retry</);
    assert.match(html, /Connection status could not be read/);
  });
});

describe("service-board session gate + security headers (rea-hardening)", () => {
  it("ServiceBoard gates oauth/*/status probes on an active session", () => {
    const src = readFileSync(join(root, "src/components/mind/service-board.tsx"), "utf8");
    assert.match(src, /useCurrentUserState/);
    assert.match(src, /sessionActive/);
    assert.match(src, /sessionActiveRef/);
    assert.match(src, /STATUS_UNAVAILABLE_SIGNIN_DETAIL/);
    assert.match(src, /Only probe when a session is active/);
    // Must not call refreshAll unconditionally on mount anymore.
    assert.doesNotMatch(src, /useEffect\(\(\) => \{\s*refreshAll\(\);/);
  });

  it("vercel.json ships browser security headers + CSP Report-Only (not enforced)", () => {
    const raw = readFileSync(join(root, "vercel.json"), "utf8");
    const cfg = JSON.parse(raw) as {
      headers?: { source?: string; headers?: { key: string; value: string }[] }[];
      git?: { deploymentEnabled?: Record<string, boolean> };
      ignoreCommand?: string;
    };
    const global = (cfg.headers ?? []).find((h) => h.source === "/(.*)");
    assert.ok(global, "expected catch-all /(.*) header rule");
    const map = Object.fromEntries((global?.headers ?? []).map((h) => [h.key, h.value]));
    assert.equal(map["X-Content-Type-Options"], "nosniff");
    assert.equal(map["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.equal(map["X-Frame-Options"], "DENY");
    assert.match(map["Permissions-Policy"] ?? "", /microphone=\(self\)/);
    assert.match(map["Permissions-Policy"] ?? "", /camera=\(self\)/);
    const csp = map["Content-Security-Policy-Report-Only"] ?? "";
    assert.ok(csp.length > 40, "CSP Report-Only must be present");
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /https:\/\/grok\.com/);
    assert.match(csp, /xarxhdsnprpnosimehon\.supabase\.co/);
    assert.match(csp, /accounts\.google\.com/);
    assert.match(csp, /github\.com/);
    assert.match(csp, /api\.x\.ai/);
    assert.equal(map["Content-Security-Policy"], undefined, "CSP must stay report-only until preview check");
    assert.equal(cfg.git?.deploymentEnabled?.["fix/rea-hardening"], false);
    assert.match(cfg.ignoreCommand ?? "", /fix\/rea-hardening/);
  });
});
