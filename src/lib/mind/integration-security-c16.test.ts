import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { escapeHtml } from "./connectors/oauth-callback-html.ts";
import { pendingOAuthPath, isValidOAuthState } from "./connectors/store.ts";
import { handleBuiltinMcpHttp } from "./mcp/builtin-server.ts";
import { SEARCH_TIMEOUT_REPLY, DEFAULT_SEARCH_TIMEOUT_MS, DEFAULT_DEEP_SEARCH_TIMEOUT_MS } from "./research.ts";
import { GROK_IMAGINE_MODEL, resolveImagineModel } from "./media/imagine-shared.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const researchSrc = readFileSync(join(root, "src/lib/mind/research.ts"), "utf8");
const commandApp = readFileSync(join(root, "src/components/mind/command-app.tsx"), "utf8");
const imagineSrc = readFileSync(join(root, "src/lib/mind/media/imagine.ts"), "utf8");
const hardenPath = join(root, "src/lib/mind/media/harden.ts");

describe("integration-security-c16", () => {
  it("anon POST /api/mind/mcp/builtin tools/call returns 401 and never runs SQL", async () => {
    const calls: string[] = [];
    const response = await handleBuiltinMcpHttp(
      new Request("http://127.0.0.1/api/mind/mcp/builtin", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "pglite_query", arguments: { sql: "SELECT 1" } },
        }),
      }),
      {
        authenticate: async () => null,
        getSql: async () => ({
          query: async (sql: string) => {
            calls.push(sql);
            return [{ ok: true }];
          },
        }),
      },
    );
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
    assert.match(await response.text(), /sign in/i);
  });

  it("OAuth callback escapes XSS payloads and rejects ../ state traversal", () => {
    const payload = '<img src=x onerror="alert(1)">';
    const escaped = escapeHtml(payload);
    assert.equal(escaped.includes("<img"), false);
    assert.match(escaped, /&lt;img/);
    for (const bad of ["../../victim/important", "../x", "a/b", "..", "/tmp/x"]) {
      assert.equal(isValidOAuthState(bad), false);
      assert.equal(pendingOAuthPath(bad), null);
    }
  });

  it("search timeout markers survived the merge", () => {
    assert.equal(SEARCH_TIMEOUT_REPLY, "Search timed out. No citations were created.");
    assert.equal(DEFAULT_SEARCH_TIMEOUT_MS, 15_000);
    assert.equal(DEFAULT_DEEP_SEARCH_TIMEOUT_MS, 45_000);
    assert.match(researchSrc, /export const SEARCH_TIMEOUT_REPLY/);
    assert.match(researchSrc, /MIND_SEARCH_TIMEOUT_MS/);
    assert.match(researchSrc, /MIND_SEARCH_DEEP_TIMEOUT/);
    assert.match(researchSrc, /boundAbortSignal/);
  });

  it("Imagine unknown-model allowlist collapses arbitrary ids", () => {
    // Media H4 landed: resolveImagineModel + harden allowlist + dedicated harden tests.
    assert.equal(existsSync(hardenPath), true);
    assert.match(imagineSrc, /resolveImagineModel\(/);
    assert.equal(existsSync(join(root, "src/lib/mind/media/imagine-harden-h4h7.test.ts")), true);
    assert.equal(resolveImagineModel("gpt-image-1"), GROK_IMAGINE_MODEL);
    assert.equal(resolveImagineModel("grok-imagine-image-pro-ultra"), GROK_IMAGINE_MODEL);
    assert.match(commandApp, /onImagine|runImagine/);
  });

  it("keeps sibling lane markers after security merges", () => {
    for (const needle of [
      'data-testid="open-voice-mode"',
      "VoiceModeOverlay",
      'data-testid="failure-banner"',
      'data-testid="executing-tools"',
      "ModelTierChip",
      "mcpToolFailure",
      "ServiceBoard",
    ]) {
      assert.match(commandApp, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(readFileSync(join(root, "src/routes/explore.tsx"), "utf8"), /PersonaDirectoryView/);
  });
});
