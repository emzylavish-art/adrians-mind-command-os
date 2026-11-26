import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const node = ast.statements.find((statement) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "mindStatus"));
assert.ok(node, "mindStatus remains an actual server entrypoint");
const compiled = ts.transpileModule(node!.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

async function status(state: "on" | "off" | "unknown", configured: boolean) {
  const exports: { mindStatus?: () => Promise<Record<string, unknown>> } = {};
  const modules = {
    "../auth/verify.server": { requireUserId: async () => "fixture-owner" },
    "./halt.server": { readHaltState: async () => state },
    "./logic-route-adapter.server.ts": { inspectLogicRoutes: async () => [] },
    "./logic-routes.ts": { toPublicLogicRoute: (value: unknown) => value },
  };
  runInNewContext(compiled, {
    exports, Date, MODEL: "fixture-model", NEMOTRON_MODEL: "fixture-model",
    process: { env: {} },
    require: (name: keyof typeof modules) => { assert.ok(name in modules, `unexpected dependency ${name}`); return modules[name]; },
    createServerFn: () => ({ handler: (callback: () => unknown) => callback }),
    envCheck: () => ({ ok: true }),
    describePersistence: () => ({ note: "Fixture configuration", backend: "fixture" }),
    resolveDatabaseUrl: () => undefined,
    selectProvider: () => ({ ok: false }),
    resolveXaiInferenceApiKey: () => ({ ok: configured }),
    modelTierCatalog: () => [], configuredProviders: () => [],
    fetch: () => { throw new Error("A configuration status check must not make a paid verification call."); },
  });
  return exports.mindStatus!();
}

test("actual status endpoint keeps unknown emergency-stop storage distinct while blocking execution", async () => {
  const unknown = await status("unknown", true);
  const stopped = await status("on", true);
  const running = await status("off", true);
  assert.equal(unknown.executionHaltState, "unknown");
  assert.equal(unknown.executionHalted, true);
  assert.match(String(unknown.executionHaltDetail), /storage.*checked/);
  assert.equal(stopped.executionHaltState, "on");
  assert.equal(stopped.executionHalted, true);
  assert.equal(running.executionHaltState, "off");
  assert.equal(running.executionHalted, false);
});

test("actual status endpoint identifies configuration evidence without asserting provider health", async () => {
  const configured = await status("off", true);
  const missing = await status("off", false);
  assert.equal(configured.evidenceKind, "configuration");
  assert.equal(configured.grok, "configured");
  assert.equal(missing.grok, "unconfigured");
  assert.notEqual(configured.grok, "healthy");
});
