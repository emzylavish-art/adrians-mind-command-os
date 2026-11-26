import assert from "node:assert/strict";
import { test } from "node:test";
import { measureFrontendSource, readFrontendArchitecture, reviewFrontendArchitecture } from "./frontend-architecture.mjs";

function fixtureBaseline(sources, presentationOnly = false) {
  return { files: Object.fromEntries(Object.entries(sources).map(([file, content]) => {
    const result = measureFrontendSource(file, content);
    return [file, { featureAreas: result.featureAreas, runtimeImports: result.runtimeImports, presentationOnly, limits: { lines: 1000, largestFunctionLines: 1000, stateHooks: 20, effects: 20, refs: 20, runtimeDependencyCount: 100 } }];
  })) };
}

test("architecture AST counts actual aliased hooks, excluding comments and erased type dependencies", () => {
  const metrics = measureFrontendSource("fixture.tsx", `import { useState as state, useEffect } from "react";
import type { ServerResult } from "@/lib/mind/server";
// useState(1); useEffect(() => {});
const example = "useState()";
export function Surface(){ const [value] = state(0); useEffect(() => {}, []); return <p>{value}</p>; }`);
  assert.equal(metrics.stateHooks, 1); assert.equal(metrics.effects, 1);
  assert.deepEqual(metrics.runtimeImports, []);
});

test("a same-line synthetic increase in cross-feature coupling is detected independently of file size", () => {
  const file = "src/components/mind/example.tsx";
  const original = 'import { View } from "@/components/mind/chat-empty-hero"; export const Surface = View;';
  const enlarged = 'import { View } from "@/components/mind/chat-empty-hero"; import { build } from "@/lib/mind/kimi/build-review"; import { connect } from "@/lib/mind/notion"; import { voice } from "@/lib/mind/voice/capture-utterance"; export const Surface = View;';
  const baseline = fixtureBaseline({ [file]: original });
  const result = reviewFrontendArchitecture({ [file]: enlarged }, baseline);
  assert.equal(result.metrics[file].lines, 1);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((item) => item.kind === "new-feature-coupling" && /build/.test(item.detail) && /integrations/.test(item.detail) && /voice/.test(item.detail)));
  assert.equal(result.signals[0].imports.length, 3);
  assert.ok(result.violations.every((item) => item.kind !== "budget-growth"));
});

test("presentation boundaries cannot directly acquire provider dispatch or persistence ownership", () => {
  const file = "src/components/mind/chat-pane.tsx";
  const source = 'import { send } from "@/lib/mind/server"; import { save } from "@/lib/mind/store"; export const Surface = () => null;';
  const baseline = fixtureBaseline({ [file]: source }, true);
  const result = reviewFrontendArchitecture({ [file]: source }, baseline);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((item) => item.kind === "presentation-side-effect-import" && /server/.test(item.detail) && /store/.test(item.detail)));
});

test("lazy service imports retain their feature coupling and presentation ownership checks", () => {
  const file = "src/components/mind/chat-pane.tsx";
  const source = 'export const Surface = () => null;';
  const changed = source + ' const load = () => import("@/lib/mind/server");';
  const result = reviewFrontendArchitecture({ [file]: changed }, fixtureBaseline({ [file]: source }, true));
  assert.equal(result.ok, false);
  assert.ok(result.metrics[file].runtimeImports.includes("@/lib/mind/server"));
  assert.ok(result.violations.some((item) => item.kind === "presentation-side-effect-import"));
});

test("a reverse feature-to-shell dependency and tracked module cycle are reported", () => {
  const sources = { "src/components/mind/command-app.tsx": 'import { ChatPane } from "./chat-pane"; export const Shell = ChatPane;', "src/components/mind/chat-pane.tsx": 'import { Shell } from "./command-app"; export const ChatPane = Shell;' };
  const baseline = fixtureBaseline(sources);
  baseline.files["src/components/mind/chat-pane.tsx"].presentationOnly = true;
  const result = reviewFrontendArchitecture(sources, baseline);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((item) => item.kind === "feature-cycle"));
  assert.ok(result.violations.some((item) => item.kind === "presentation-side-effect-import"));
});

test("the current application and extracted conversation boundaries satisfy the checked-in architecture baseline", () => {
  const result = readFrontendArchitecture();
  assert.equal(result.ok, true, JSON.stringify(result.violations, null, 2));
  assert.ok(result.metrics["src/components/mind/command-app.tsx"].runtimeDependencyCount > 0);
  assert.ok(result.metrics["src/components/mind/chat-pane.tsx"].runtimeImports.includes("./chat-controls"));
});
