import * as provider_lifecycle from "./provider-lifecycle.ts";
import * as ai_provider_stream from "./ai-provider-stream.ts";
import * as provider_call_stream from "./provider-call-stream.ts";
import * as provider_usage from "./provider-usage.ts";
import * as provider_dependencies from "./provider-dependencies.ts";
import * as model_capabilities from "./model-capabilities.ts";
import * as provider_catalog from "./provider-catalog.ts";
import * as provider_receipt from "./provider-receipt.ts";
import * as stream from "./stream.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { oauthBoardState } from "./connection-board.ts";
import { isStatusUnavailable, unavailableStatus } from "./service-board-status.ts";
import { OwnerRequestGate } from "./owner-request-gate.ts";
import { discoveryFailureState } from "./provider-health.ts";
import { buildProviderChatRequest, parseProviderText, providerWireProtocol, modelDiscoveryHeaders } from "./ai-provider-native.ts";

function compile(path: URL, imports: Record<string, unknown>) {
  const module = { exports: {} as Record<string, any> };
  const code = ts.transpileModule(readFileSync(path, "utf8"), { fileName: path.pathname, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
    if (!(name in imports)) throw new Error(`Unexpected dependency ${name}`);
    return imports[name];
  }, URL, AbortSignal, Headers, Request, Response, console });
  return module.exports;
}

function providerFixture() {
  const row = { id: "provider-a", label: "Fixture", base_url: "https://api.example.test/v1", key_ciphertext: "sealed-fixture", default_model: "model-a", models: ["model-a"], status: "configured", last_error: "" };
  let status = 200;
  let reachable = true;
  const events: string[] = [];
  const sql = { query: async (query: string, args: unknown[]) => {
    if (query.startsWith("select")) return [row];
    if (query.includes("set base_url")) { row.status = String(args[5]); row.last_error = String(args[6]); }
    if (query.includes("set status=$3")) { row.status = String(args[2]); row.last_error = String(args[3]); }
    return [];
  } };
  const api = compile(new URL("./ai-provider-config.server.ts", import.meta.url), {
    "node:crypto": { randomUUID: () => "fixture-id" },
    "./provider-health.ts": { discoveryFailureState },
    "./ai-provider-native.ts": { buildProviderChatRequest, parseProviderText, providerWireProtocol, modelDiscoveryHeaders },
    "../db.ts": { getSql: async () => sql },
    "./connectors/crypto.ts": { decryptSecret: () => "fake-key", encryptSecret: () => ({ ciphertext: "sealed" }), connectorTokenSecretStatus: () => ({ ok: true }) },
    "./provider-lifecycle.ts": provider_lifecycle,
    "./ai-provider-stream.ts": ai_provider_stream,
    "./provider-call-stream.ts": provider_call_stream,
    "./provider-usage.ts": provider_usage,
    "./provider-dependencies.ts": provider_dependencies,
    "./model-capabilities.ts": model_capabilities,
    "./provider-catalog.ts": provider_catalog,
    "./provider-receipt.ts": provider_receipt,
    "./stream.ts": stream,
    "./mcp/http-dns-pin.ts": {
      isLocalHostname: () => false, isPrivateAddressLiteral: () => false,
      resolveAndPinMcpHostname: async () => { events.push("dns"); return reachable ? { ok: true, pinnedAddress: "203.0.113.10", hostname: "api.example.test" } : { ok: false }; },
      pinnedHttpFetch: async (_url: URL, _address: string, _host: string, init: RequestInit) => {
        events.push(String(init.method));
        return { status, headers: new Headers(), text: async () => JSON.stringify(init.method === "GET" ? { data: [{ id: "model-a" }] } : { model: "model-a", choices: [{ message: { content: "fixture answer" } }] }) };
      },
    },
  });
  return { api, row, events, status: (next: number) => { status = next; }, reachable: (next: boolean) => { reachable = next; } };
}

test("C5 AA010 marks custom dispatch only after the real preflight and DNS boundary", async () => {
  const f = providerFixture();
  const call = () => f.api.executeCustomChat("owner", { id: "provider-a", model: "model-a" }, [{ role: "user", content: "hello" }], undefined, { onDispatch: () => f.events.push("dispatched") });
  f.row.status = "credentials_rejected";
  assert.equal((await call()).ok, false);
  assert.deepEqual(f.events, []);
  f.row.status = "configured";
  f.reachable(false);
  assert.equal((await call()).ok, false);
  assert.deepEqual(f.events, ["dns"]);
  f.events.length = 0;
  f.reachable(true);
  assert.equal((await call()).ok, true);
  assert.deepEqual(f.events, ["dns", "dispatched", "POST"]);
});

test("C5 AA011 repeated unsupported listings cannot heal a rejected credential", async () => {
  const f = providerFixture();
  f.status(401);
  assert.equal((await f.api.discoverAiModels("owner", "provider-a")).provider.status, "credentials_rejected");
  f.status(404);
  for (let i = 0; i < 2; i++) assert.equal((await f.api.discoverAiModels("owner", "provider-a")).provider.status, "credentials_rejected");
  f.status(200);
  assert.equal((await f.api.discoverAiModels("owner", "provider-a")).provider.status, "catalogued");
  f.row.status = "configured";
  f.status(404);
  assert.equal((await f.api.discoverAiModels("owner", "provider-a")).provider.status, "configured");
});

test("C5 AA012 late list responses cannot overwrite mutation refreshes or another owner", () => {
  const gate = new OwnerRequestGate("owner-a");
  const initial = gate.begin("owner-a");
  const mutation = gate.begin("owner-a");
  assert.equal(gate.accept(initial, "owner-a"), false);
  assert.equal(gate.accept(mutation, "owner-a"), true);
  const refresh = gate.begin("owner-a");
  assert.equal(gate.accept(mutation, "owner-a"), false);
  assert.equal(gate.accept(refresh, "owner-b"), false);
  gate.close();
  assert.equal(gate.accept(refresh, "owner-a"), false);
  assert.equal(new OwnerRequestGate("owner-b").accept(refresh, "owner-a"), false);
});

test("C5 AA013 actual provider route rejects a stale form owner before any mutation", async () => {
  let mutations = 0;
  const route = compile(new URL("../../routes/api/mind/providers.ts", import.meta.url), {
    "@tanstack/react-router": { createFileRoute: () => (definition: unknown) => definition },
    "@/lib/auth/verify.server": { requireUserId: async () => "owner-b", UnauthorizedError: class extends Error {} },
    "@/lib/mind/connectors/oauth-csrf": { assertSameOrigin: () => ({ ok: true }) },
    "@/lib/mind/rate-limit.server": { allowSharedMindRequest: () => true },
    "@/lib/mind/environment-model-catalog.server": { listEnvironmentModelCatalogs: async () => [] },
    "@/lib/mind/halt.server": { readHaltState: () => "off" },
    "@/lib/mind/ai-provider-config.server": {
      listAiProviders: async () => [],
      saveAiProvider: async () => { mutations++; return { ok: true, provider: { id: "new" } }; },
      discoverAiModels: async () => { mutations++; return { ok: true, provider: { id: "new" } }; },
    },
  }).Route;
  const request = (expectedOwnerId: string) => new Request("https://fixture.test/api/mind/providers", { method: "POST", body: JSON.stringify({ action: "save", expectedOwnerId, apiKey: "synthetic-only" }) });
  const refused = await route.server.handlers.POST({ request: request("owner-a") });
  assert.equal(refused.status, 409);
  assert.equal(mutations, 0);
  const saved = await route.server.handlers.POST({ request: request("owner-b") });
  assert.equal(saved.status, 200);
  assert.equal(mutations, 2);
  const listed = await route.server.handlers.GET({ request: new Request("https://fixture.test/api/mind/providers") });
  assert.equal((await listed.json()).ownerId, "owner-b");
});

test("C5 AA001/003 integration views use account observations and never map inaccessible status to disconnected", () => {
  const app = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
  const integrations = app.slice(app.indexOf('{view === "integrations"'), app.indexOf('{view === "activity"', app.indexOf('{view === "integrations"')));
  assert.match(integrations, /<ServiceBoard[\s\S]*providers=\{customAiProviders\}[\s\S]*savedMcp=/);
  assert.doesNotMatch(integrations, /isVerifiedCapability|item\.status|item\.why/);
  const board = readFileSync(new URL("../../components/mind/service-board.tsx", import.meta.url), "utf8");
  assert.match(board, /needsSignIn \? "Sign in required"/);
  assert.doesNotMatch(board, /needsSignIn \? "Not connected"/);
});

test("C5 AA012/013/014 owner-scoped UI and canonical session are wired to guarded route", () => {
  const providers = readFileSync(new URL("../../components/mind/ai-provider-connections.tsx", import.meta.url), "utf8");
  assert.match(providers, /<OwnedAiProviderConnections key=\{user\.id\} ownerId=\{user\.id\}/);
  assert.match(providers, /expectedOwnerId: ownerId/);
  assert.match(providers, /if \(!gate\.accept\(ticket, ownerId\)\) return/);
  assert.match(providers, /return \(\) => \{ gate\.close\(\); \}/);
  const currentUser = readFileSync(new URL("../auth/use-current-user.ts", import.meta.url), "utf8");
  assert.match(currentUser, /readSessionIdentity\(fetch, \x60\$\{prefix\}\/api\/mind\/session\x60, getBearerToken\(\)\)/);
  assert.match(currentUser, /const verifiedId = keyIsCurrent \? session\.user\?\.id : undefined/);
  assert.match(currentUser, /verifiedId === data\?\.user\.id/);
});

test("C5 AA016 exact review and cancellation stay attached to the originating draft", () => {
  const app = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
  const mcp = app.slice(app.indexOf("async function askMcp("), app.indexOf("async function askMcp(") + 4600);
  assert.match(mcp, /review: "approval" in result/);
  assert.match(mcp, /JSON\.stringify\(\[draftOwner, chat\.id, chat\.temporary\]\)/);
  assert.match(mcp, /setDraftInScope\(scope/);
  assert.match(app, /aria-label="Exact action to approve"/);
  assert.match(app, /pending\.cancel\?\.\(\); setPending\(null\)/);
});


test("C5 AA003 rendered Plugins badges distinguish sign-in, unavailable and a confirmed absent grant", () => {
  for (const [status, expected] of [[unavailableStatus(401), "Sign in required"], [unavailableStatus(503), "Status unavailable"], [{ state: "not_connected", detail: "No saved grant." }, "Not connected"]] as const) {
    let stateIndex = 0;
    const component = compile(new URL("../../components/mind/service-board.tsx", import.meta.url), {
      "react": { ...React, useState: (initial: unknown) => React.useState(stateIndex++ === 0 ? { Notion: status } : stateIndex === 7 ? true : initial) },
      "react/jsx-runtime": jsxRuntime,
      "@/lib/auth/client": { getBearerToken: () => null },
      "@/lib/mind/connectors/oauth-return": { rememberOAuthReturn: () => undefined },
      "lucide-react": { AudioLines: () => null, Image: () => null, Monitor: () => null, Search: () => null, Cpu: () => null },
      "./connector-directory": { ConnectorDirectory: () => null },
      "./focus-connection": { focusConnection: () => undefined },
      "./notion-workspaces": { NotionWorkspaces: () => null },
      "@/components/mind/kimi-device-connect": { KimiDeviceConnect: () => null },
      "@/lib/mind/mcp-storage-status": { checkMcpStorage: () => { throw new Error("no transport in render"); } },
      "@/lib/mind/connection-board": { oauthBoardState },
      "@/lib/mind/service-board-status": { isStatusUnavailable },
      "@/lib/mind/oauth-board-action": { OauthBoardActionStatusRows: () => null },
    }).ServiceBoard;
    const html = renderToStaticMarkup(React.createElement(component, { grokConfigured: null, onSetup: () => undefined }));
    const notion = html.slice(html.indexOf('id="connection-notion"')).split("</article>")[0];
    assert.match(notion, new RegExp(`plugin-link__state">${expected}<`));
    if (expected !== "Not connected") assert.doesNotMatch(notion, /plugin-link__state">Not connected</);
  }
});


test("C5 AA014 preview sign-out requires confirmed removal of all cookie sessions even without a bearer", async () => {
  const { runSignOut } = await import("../../../scripts/sign-out-plan.mjs");
  const source = readFileSync(new URL("../auth/client.ts", import.meta.url), "utf8");
  const module = { exports: {} as { signOut?: (target: string) => Promise<void> } };
  const events: string[] = [];
  let fail = true;
  const location = { set href(value: string) { events.push(`redirect:${value}`); } };
  const code = ts.transpileModule(source.slice(source.indexOf("export async function signOut(")), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { module, exports: module.exports, runSignOut, inLivePreview: () => true, getBearerToken: () => null,
    requestAllSessionSignOut: async () => { events.push("all-sessions"); if (fail) throw new Error("fixture failure"); },
    setBearerToken: () => { events.push("clear"); }, window: { location } });
  await assert.rejects(module.exports.signOut!("/login"), /Sign-out failed/);
  assert.deepEqual(events, ["all-sessions"]);
  fail = false;
  events.length = 0;
  await module.exports.signOut!("/login");
  assert.deepEqual(events, ["all-sessions", "clear", "redirect:/login"]);
});
