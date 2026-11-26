import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { paletteHits, paletteShortcut } from "./palette.ts";
import { createChat, emptyWorkspace, normalizeWorkspace, updateChatCustomPersonality, updateChatPersonality } from "./workspace.ts";
import { normalizeCustomPersonality, personalityInstruction } from "./personalities/index.ts";
import { closeRecovery, normalizeRecovery, saveRecovery } from "./recovery-inbox.ts";

const source = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");

function actualNode(predicate: (node: ts.Node) => boolean): string {
  const ast = ts.createSourceFile("command-app.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Node | undefined;
  function visit(node: ts.Node) { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); }
  visit(ast); assert.ok(found); return found.getText(ast);
}

test("AA064/065: actual overlay opens as a named native modal, cancels, closes and restores its opener", () => {
  const ast = ts.createSourceFile("command-app.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.match(source, /WorkspaceDialog as Overlay/);
  const modal = readFileSync(new URL("../../components/mind/workspace-dialog.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(modal, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const events: string[] = [];
  class Element { isConnected = true; getClientRects() { return [{}]; } focus() { events.push("restore-focus"); } }
  const opener = new Element();
  let effect: (() => (() => void)) | undefined;
  const dialog = { showModal() { events.push("native-modal"); }, close() { events.push("close"); } };
  const context: any = { exports: {}, HTMLElement: Element, document: { activeElement: opener, body: {} },
    require: (name: string) => name === "react" ? {
      useRef: (value: unknown) => ({ current: value ?? dialog }), useEffect: (fn: () => (() => void)) => { effect = fn; }
    } : { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) } };
  runInNewContext(compiled, context);
  const tree = context.exports.WorkspaceDialog({ children: "Fixture", labelledBy: "fixture-title", onDismiss: () => events.push("dismiss") });
  assert.equal(tree.type, "dialog");
  assert.equal(tree.props["aria-modal"], "true");
  assert.equal(tree.props["aria-labelledby"], "fixture-title");
  const cleanup = effect!();
  tree.props.onCancel({ preventDefault() { events.push("cancel-default"); } });
  cleanup();
  assert.deepEqual(events, ["native-modal", "cancel-default", "dismiss", "close", "restore-focus"]);
  // Every call site must provide an accessible name and a real dismissal action.
  const uses: ts.JsxOpeningElement[] = [];
  function visit(node: ts.Node) { if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "Overlay") uses.push(node); ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(uses.length >= 6);
  for (const use of uses) {
    const props = use.attributes.properties.filter(ts.isJsxAttribute).map((prop) => prop.name.getText(ast));
    assert.ok(props.includes("labelledBy")); assert.ok(props.includes("onDismiss"));
  }
});

test("AA120–124: search ranks exact titles, searches independent words, and exposes each matching message with scope", () => {
  const input = { query: "launch budget", projects: [{ id: "p", name: "North", description: "" }], agents: [], runs: [], files: [], memories: [],
    chats: [{ id: "title", title: "Launch Budget", messages: [], projectId: "p" },
      { id: "history", title: "Planning", archived: true, temporary: true, projectId: "p", messages: [{ id: "m1", content: "Budget is ready for the launch." }, { id: "m2", content: "Launch uses the approved budget." }] }] };
  const hits = paletteHits(input);
  assert.equal(hits[0]?.ref, "title");
  assert.deepEqual(hits.filter((hit) => hit.ref === "history").map((hit) => hit.messageId).sort(), ["m1", "m2"]);
  assert.ok(hits.filter((hit) => hit.ref === "history").every((hit) => /Archived.*Temporary.*North/.test(hit.meta)));
  assert.equal(paletteHits({ ...input, query: '"launch budget"' }).some((hit) => hit.ref === "history"), false);
  assert.equal(paletteHits({ ...input, query: "North" }).filter((hit) => hit.view === "chat").length, 2);
  assert.equal(paletteShortcut("MacIntel"), "⌘K"); assert.equal(paletteShortcut("Win32"), "Ctrl K");
});

test("AA126–128: custom style preserves paragraphs and import normalization retains actionable fallback/truncation warnings", () => {
  const raw = "First instruction.\n\nSecond instruction.";
  assert.equal(normalizeCustomPersonality(raw), raw);
  assert.ok(personalityInstruction("custom", raw).includes(raw));
  const made = createChat(emptyWorkspace(), { memory: "off", temporary: false, autonomy: "ask", projectId: null });
  const imported = normalizeWorkspace({ ...made.ws, chats: [{ ...made.chat, personalityId: "retired-style", customPersonality: "x".repeat(900) }] });
  assert.equal(imported.chats[0]?.personalityId, "assistant");
  assert.equal(imported.chats[0]?.personalityFallback, "retired-style");
  assert.equal(imported.chats[0]?.customPersonalityTruncated, true);
  const reopened = normalizeWorkspace(imported);
  assert.equal(reopened.chats[0]?.personalityFallback, "retired-style");
  const edited = updateChatCustomPersonality(updateChatPersonality(reopened, made.chat.id, "custom"), made.chat.id, raw);
  assert.equal(edited.chats[0]?.personalityFallback, undefined);
  assert.equal(edited.chats[0]?.customPersonalityTruncated, undefined);
});

test("AA029–032: multiple pending recoveries survive normalization and unrelated actions; resolving one cannot erase another", () => {
  let ws = emptyWorkspace();
  for (const id of ["first", "second"]) ws = saveRecovery(ws, { id, at: "2026-11-25T12:00:00Z", action: "review", target: "fixture", message: id, state: "open", operationId: id });
  ws = { ...ws, chats: createChat(ws, { memory: "off", temporary: false, autonomy: "ask", projectId: null }).ws.chats };
  const restored = normalizeWorkspace(ws);
  assert.equal(restored.recovery?.length, 2);
  assert.equal(closeRecovery(restored, "first", "resolved").recovery?.find((row) => row.id === "second")?.state, "open");
  assert.equal(normalizeRecovery([restored.recovery![0], restored.recovery![0]]).length, 1);
});

test("AA060/062/063: actual hidden-storage and polling callbacks avoid unnecessary work", () => {
  const initializer = actualNode((node) => ts.isVariableDeclaration(node) && node.name.getText() === "storedBytes");
  let serialized = 0;
  const state: any = { view: "chat", settingsPane: "data", ws: {}, Blob, useMemo: (fn: () => unknown) => fn(), JSON: { stringify: () => { serialized++; return "{}"; } } };
  runInNewContext(`globalThis.bytes = (${initializer.slice(initializer.indexOf("=") + 1)});`, state);
  assert.equal(serialized, 0); assert.equal(state.bytes, 0);
  state.view = "settings";
  runInNewContext(`globalThis.bytes = (${initializer.slice(initializer.indexOf("=") + 1)});`, state);
  assert.equal(serialized, 1); assert.ok(state.bytes > 0);

  const polling = actualNode((node) => ts.isCallExpression(node) && node.expression.getText() === "useEffect" && node.getText().includes('workerId: "browser-worker"'));
  let tick: (() => void) | undefined, writes = 0, calls = 0;
  const workspace = { ...emptyWorkspace(), runs: [{ id: "scheduled:fixture", state: "running" }] };
  const context = { ready: true, accountPending: false, account: { id: "fixture" }, useEffect: (fn: () => unknown) => fn(), wsRef: { current: workspace }, desktopActedRef: { current: new Set() }, Date,
    runDueSchedules: (ws: unknown) => ws, tickFleet: (ws: unknown) => ws, setWs: () => { writes++; },
    spokenPcCommand: () => false, fetch: () => { calls++; }, window: { setInterval: (fn: () => void) => { tick = fn; return 1; }, clearInterval() {} } };
  runInNewContext(ts.transpileModule(polling, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  tick!(); assert.equal(writes, 0); assert.equal(calls, 0);

  const recording = actualNode((node) => ts.isCallExpression(node) && node.expression.getText() === "useEffect" && node.getText().includes("setTaskSeconds(Math.round"));
  let delay = 0, seconds = 0;
  runInNewContext(recording, { useEffect: (fn: () => unknown) => fn(), taskRecording: true, taskRecorder: { current: { elapsed: () => 2300 } }, setTaskSeconds: (value: number) => { seconds = value; }, window: { setInterval: (fn: () => void, ms: number) => { delay = ms; fn(); return 1; }, clearInterval() {} } });
  assert.equal(delay, 1000); assert.equal(seconds, 2);
});

test("AA017: actual Speak answer attribution is returned by that turn and cannot reuse a previous turn receipt", async () => {
  const handler = actualNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === "speakChatTurn");
  const made = createChat(emptyWorkspace(), { memory: "off", temporary: false, autonomy: "ask", projectId: null });
  let provideReceipt = true;
  const context: any = { exports: {}, activeId: made.chat.id, preferenceStorage: { getItem: () => null }, wsRef: { current: made.ws }, speakStylePersonality: () => "assistant", localStorage: { getItem: () => null }, parseCreateBot: () => false,
    deliver: async (_chat: unknown, _text: string, _source: unknown, _resume: boolean, _images: unknown, options: { onReply: (receipt: unknown) => void }) => { if (provideReceipt) options.onReply({ provider: "Gemini", model: "fixture-reported" }); return "fixture answer"; } };
  runInNewContext(ts.transpileModule(`${handler}\nexports.speakChatTurn = speakChatTurn;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  const first = await context.exports.speakChatTurn("one", { stay: true });
  assert.equal(first.provider, "Gemini"); assert.equal(first.model, "fixture-reported");
  provideReceipt = false;
  const second = await context.exports.speakChatTurn("two", { stay: true });
  assert.equal(second.provider, "not reported"); assert.equal(second.model, undefined);
});

test("AA068: mobile drawer uses colors declared by both the dark and light themes", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const rule = css.match(/\.shell \.rail\.nav-drawer-open \{([^}]+)/)?.[1] ?? "";
  for (const property of ["background", "color"]) {
    const value = rule.match(new RegExp(`${property}: var\\((--[a-z-]+)\\)`))?.[1];
    assert.ok(value, `${property} must reference a theme token`);
    assert.ok((css.match(new RegExp(`${value}:`, "g"))?.length ?? 0) >= 2, `${value} must be defined for both themes`);
  }
});

test("AA016: actual staged-call guard rejects account changes and every stage close aborts pending capture", () => {
  const handler = actualNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === "speak");
  const guard = handler.match(/const current = ([^;]+);/)?.[1];
  assert.ok(guard);
  const state = { turnOwner: { current: 'owner-a' }, draftOwner: 'owner-a', generation: 1, speakGenRef: { current: 1 }, abort: new AbortController(), wsRef: { current: { halted: false } } };
  assert.equal(runInNewContext(`(${guard})()`, state), true);
  state.turnOwner.current = 'owner-b'; assert.equal(runInNewContext(`(${guard})()`, state), false);
  state.turnOwner.current = 'owner-a';
  const transition = actualNode(node => ts.isCallExpression(node) && node.getText().includes("if (speakStageOpenRef.current && !speakStageOpen) interruptSpeakPlayback()") && node.expression.getText().startsWith("use"));
  const open = { current: true };
  runInNewContext(transition, { speakStageOpenRef: open, speakStageOpen: false, useEffect: (fn: () => void) => fn(), useLayoutEffect: (fn: () => void) => fn(), interruptSpeakPlayback: () => state.abort.abort() });
  assert.equal(open.current, false);
  assert.equal(runInNewContext(`(${guard})()`, state), false);
});
