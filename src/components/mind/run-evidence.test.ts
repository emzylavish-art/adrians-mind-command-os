import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { emptyWorkspace } from "../../lib/mind/workspace.ts";
import { addAgentFromTemplate, enqueueRun } from "../../lib/mind/fleet.ts";

const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith("/run-evidence.tsx")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
  return next(url, context);
} });
const { RunCountsView, RunEvidence } = await import("./run-evidence.tsx");
hooks.deregister();

test("AA020/021/023 real run evidence markup separates local completion, objective proof and cancellation", () => {
  const added = addAgentFromTemplate(emptyWorkspace(), "Personal assistant"); assert(added.ok);
  const created = enqueueRun(added.ws, added.agent.id, "Read projects"); assert(created.ok);
  const run = { ...created.run, state: "completed" as const, executionRuntime: "browser-local" as const, completion: { execution: "finished" as const, objective: "unverified" as const, evidence: ["fixture result"] }, cancellation: { requestedAt: "2026-01-01T00:00:00Z", acknowledgedAt: "2026-01-01T00:00:01Z", scope: "local-worker" as const } };
  const html = renderToStaticMarkup(createElement(RunEvidence, { run }));
  assert.match(html, /Browser local worker/); assert.match(html, /Planned local steps finished/); assert.match(html, /Unverified/); assert.match(html, /Completed results remain/); assert.match(html, /Agent revision/);
});
test("AA107 real count markup uses the same categories including paused and approval work", () => {
  const added = addAgentFromTemplate(emptyWorkspace(), "Personal assistant"); assert(added.ok);
  const created = enqueueRun(added.ws, added.agent.id, "Read projects"); assert(created.ok);
  const runs = ["queued", "waiting_approval", "waiting_external", "cancel_requested", "paused"].map((state, index) => ({ ...created.run, id: `fixture-${index}`, state: state as typeof created.run.state }));
  const html = renderToStaticMarkup(createElement(RunCountsView, { runs }));
  assert.match(html, /Waiting for approval/); assert.match(html, /Cancellation pending/); assert.match(html, /Unresolved total<\/dt><dd[^>]*>5<\/dd>/);
});
