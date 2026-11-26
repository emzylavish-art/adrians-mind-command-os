import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { AgentDefinition } from "../../lib/mind/types.ts";
import { emptyWorkspace, openBotChat } from "../../lib/mind/workspace.ts";

// Run the actual TSX component through the ordinary node test runner. The hook
// changes source loading only; no component or data-service behavior is mocked.
const root = new URL("../../../", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      const base = new URL(`src/${specifier.slice(2)}`, root);
      const resolved = [".ts", ".tsx", ""].map((extension) => new URL(`${base.href}${extension}`)).find((url) => existsSync(fileURLToPath(url)));
      if (resolved) return next(resolved.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith("/knowledge-settings.tsx")) return { format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});
const { KnowledgeSettings, PdfSourceLocations } = await import("./knowledge-settings.tsx");
hooks.deregister();

const at = "2026-01-01T00:00:00.000Z";
const agent: AgentDefinition = { id: "agent", name: "Knowledge helper", description: "", instructions: "Instructions", role: "assistant", version: 1, tools: [], projectId: null, memory: "off", maxSteps: 2, approval: "ask", archived: false, createdAt: at, updatedAt: at };

test("C1 knowledge settings render real bot revision review and reversible project lifecycle controls", () => {
  const opened = openBotChat({ ...emptyWorkspace(), agents: [agent] }, agent.id)!;
  const ws = { ...opened.ws, agents: [{ ...agent, version: 2 }], projects: [{ id: "active", name: "Active project", description: "", createdAt: at }, { id: "archived", name: "Archived project", description: "", createdAt: at, archived: true }] };
  let mutations = 0;
  const html = renderToStaticMarkup(createElement(KnowledgeSettings, { ws, setWs: () => { mutations++; }, activeChatId: opened.chat.id, owner: "owner-a" }));
  assert.match(html, /Project document access is a separate conversation choice/);
  assert.match(html, /Conversation revision:/);
  assert.match(html, /Current bot revision:/);
  assert.match(html, /Review and adopt current bot/);
  assert.match(html, /Archive project/);
  assert.match(html, /Restore project/);
  assert.match(html, /Review deletion/);
  assert.equal(mutations, 0, "rendering the settings does not adopt or delete anything");
});

test("an archived bot has no adoption action and the document chooser identifies previous revisions", () => {
  const opened = openBotChat({ ...emptyWorkspace(), agents: [agent] }, agent.id)!;
  const ws = { ...opened.ws, agents: [{ ...agent, archived: true }], files: [{ id: "prior", name: "Plan prior.txt", text: "Past evidence", bytes: 13, projectId: null, createdAt: at, archived: true }] };
  const html = renderToStaticMarkup(createElement(KnowledgeSettings, { ws, setWs: () => {}, activeChatId: opened.chat.id, owner: "owner-a" }));
  assert.doesNotMatch(html, /Review and adopt current bot/);
  assert.match(html, /prior revision/);
  assert.match(html, /storing a file does not mean a model has read it/);
});


test("AA078 actual PDF evidence markup distinguishes extracted, missing and clipped page ranges", () => {
  const index = { version: 1 as const, kind: "pdf-page-tree" as const, sourceSha256: "a".repeat(64), textSha256: "b".repeat(64), pageCount: 3, extractedCharacters: 50000, retainedCharacters: 40000, pages: [{ page: 1, start: 0, end: 40000, coverage: "truncated" as const }, { page: 2, start: 40000, end: 40000, coverage: "unavailable" as const }, { page: 3, start: 40000, end: 40000, coverage: "not-retained" as const }] };
  const markup = renderToStaticMarkup(createElement(PdfSourceLocations, { index }));
  assert.match(markup, /3 ordered pages/); assert.match(markup, /Page 1: truncated/); assert.match(markup, /Page 2: unavailable/); assert.match(markup, /Page 3: not-retained/); assert.match(markup, /not PDF byte positions/);
  const unknown = renderToStaticMarkup(createElement(PdfSourceLocations, { index: { ...index, kind: "unresolved", pages: [] } }));
  assert.match(unknown, /page attribution unavailable/); assert.doesNotMatch(unknown, /Page 1:/);
});
