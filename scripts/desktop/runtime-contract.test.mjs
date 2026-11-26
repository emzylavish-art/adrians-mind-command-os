import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import runtime from "../../desktop/runtime-contract.cjs";
import network from "../../desktop/native-network.cjs";
import platforms from "../../desktop/platform-capabilities.json" with { type: "json" };
const expected = { build: 10, version: "0.9.10", revision: "b".repeat(40), deviceId: "fixture-local-device", artifactId: "fixture-build-artifact", dirty: false };
const secret = "ephemeral-child-secret";
test("readiness accepts only child-authenticated exact identity with initialized storage", () => {
  const receipt = runtime.readinessReceipt(expected, "challenge", secret, true);
  assert.equal(runtime.validateReadiness(receipt, expected, "challenge", secret), true);
  for (const value of [null, { ...receipt, build: 99 }, { ...receipt, artifactId: "a different packaged server" }, { ...receipt, dirty: true }, { ...receipt, storage: "unavailable" }, { ...receipt, product: "wrong" }, { ...receipt, proof: "a".repeat(64) }, runtime.readinessReceipt(expected, "challenge", "other-process", true)]) assert.equal(runtime.validateReadiness(value, expected, "challenge", secret), false);
  assert.equal(runtime.validateReadiness(receipt, expected, "replayed-challenge", secret), false);
});
test("local readiness does not accept login, redirect, root HTML, 404 or foreign server", async () => {
  for (const response of [new Response("login", { status: 401 }), new Response("redirect", { status: 302 }), new Response("missing", { status: 404 }), new Response("HTML", { status: 200, headers: { "content-type": "text/html" } }), Response.json({ product: "adrians-mind", ...expected })]) {
    let now = 0;
    await assert.rejects(runtime.waitForRuntime("http://127.0.0.1/api/mind/local-readiness", { exitCode: null, killed: false }, expected, secret, { now: () => now, timeoutMs: 10, pause: async () => { now += 10; }, fetch: async () => response }), /unverified/);
  }
  const result = await runtime.waitForRuntime("http://127.0.0.1/api/mind/local-readiness", { exitCode: null, killed: false }, expected, secret, { fetch: async (_url, init) => Response.json(runtime.readinessReceipt(expected, init.headers["x-adrian-runtime-challenge"], secret, true)) });
  assert.equal(result.deviceId, expected.deviceId);
});
test("startup observes dead child and bounds a read that never resolves", async () => {
  await assert.rejects(runtime.waitForRuntime("local", { exitCode: 1 }, expected, secret), /stopped/);
  await assert.rejects(runtime.waitForRuntime("local", { exitCode: null }, expected, secret, { timeoutMs: 8, fetch: () => new Promise(() => {}) }), /unverified/);
});
test("restart budget is bounded and diagnostics remove credential-like output", () => {
  let now = 0; const budget = runtime.createRestartBudget({ limit: 2, windowMs: 100, now: () => now });
  assert.equal(budget.take(), true); assert.equal(budget.take(), true); assert.equal(budget.take(), false); now = 101; assert.equal(budget.take(), true);
  const output = runtime.redactDiagnostics("Bearer fixture-secret api_key=fixture-key C:\\Users\\Example\\data /home/example/file");
  assert.doesNotMatch(output, /fixture-secret|fixture-key|Users\\Example|home\/example/);
});
test("local-only policy updates without restart and rejects external fetch or local redirect fallback", async () => {
  let policy = "local-only"; const calls = [];
  const target = { fetch: async (url, options) => { calls.push({ url, options }); return new Response("fixture"); } };
  const restore = network.installNativeFetchPolicy(target, () => policy);
  await assert.rejects(target.fetch("https://api.x.ai/v1/responses"), /Local-only/); assert.equal(calls.length, 0);
  await target.fetch("http://127.0.0.1:11434/api/chat"); assert.equal(calls[0].options.redirect, "error");
  assert.equal(network.nativeDestinationAllowed("http://localhost.evil.invalid/", policy), false); assert.equal(network.nativeDestinationAllowed("https://api.example/", policy), false);
  policy = "connected-services"; await target.fetch("https://api.example/"); assert.equal(calls.length, 2); restore();
});
test("network policy missing/corrupt file fails closed and native platforms stay unverified", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "native-policy-")); const file = path.join(dir, "prefs.json");
  try { assert.equal(network.readNetworkPolicy(file), "local-only"); await writeFile(file, "{"); assert.equal(network.readNetworkPolicy(file), "local-only"); await writeFile(file, JSON.stringify({ networkPolicy: "connected-services" })); assert.equal(network.readNetworkPolicy(file), "connected-services"); }
  finally { await rm(dir, { recursive: true, force: true }); }
  assert.equal(platforms.targets.find(target => target.platform === "win32" && target.arch === "x64").releaseVerification, "unverified");
  assert.equal(platforms.targets.find(target => target.platform === "ios").implementation, "unimplemented"); assert.equal(platforms.browserResponsiveLayoutIsNativeAppProof, false);
});
test("release packaging rejects wrong version, missing source identity or dirty source", async () => {
  const { createRequire } = await import("node:module"); const require = createRequire(import.meta.url);
  const { validateBuildIdentity } = require("../../desktop/check-build-identity.cjs");
  const identity = { product: "adrians-mind", build: 10, version: "0.9.10", revision: "b".repeat(40), artifactId: "11111111-1111-4111-8111-111111111111", dirty: false };
  assert.doesNotThrow(() => validateBuildIdentity(identity, "0.9.10"));
  for (const changed of [{ ...identity, version: "other" }, { ...identity, revision: null }, { ...identity, dirty: true }]) assert.throws(() => validateBuildIdentity(changed, "0.9.10"), /clean committed/);
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(new URL("../../desktop/package.json", import.meta.url), "utf8"));
  assert.equal(pkg.build.nsis.oneClick, false); assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true); assert.equal(pkg.build.forceCodeSigning, true); assert.equal(pkg.build.win.signAndEditExecutable, true);
  const nsis = await readFile(new URL("../../desktop/AdriansMind-full.nsi", import.meta.url), "utf8");
  assert.match(nsis, /Page directory/); assert.match(nsis, /adrian-install.marker/); assert.doesNotMatch(nsis, /WriteRegStr.*RUNASADMIN/); assert.doesNotMatch(nsis, /RMDir.*(?:APPDATA|userData)/);
});
