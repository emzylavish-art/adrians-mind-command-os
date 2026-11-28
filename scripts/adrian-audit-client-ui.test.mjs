import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { resolveShare, shareWriteForView, shareWriteDropsMissing, writeShareSearch, sameShareLocation, settingsPaneFromSearch, shareMissLabel, workLocation } from "../src/lib/mind/app-location.ts";
import { prepareLibraryDocument, saveLibraryDocument } from "../src/lib/mind/library-documents.ts";
import { addLocalFile } from "../src/lib/mind/workspace.ts";
import { togglePin } from "../src/lib/mind/fleet.ts";
import { dropCued } from "../src/lib/mind/message-cue.ts";
import { paletteKeyAction } from "../src/lib/mind/palette-keys.ts";
import * as Dialog from "@radix-ui/react-dialog";
import { ModalOverlay } from "../src/components/mind/modal-overlay.ts";

const source = ts.createSourceFile("command-app.tsx", readFileSync(new URL("../src/components/mind/command-app.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const queueSource = ts.createSourceFile("composer-queue.tsx", readFileSync(new URL("../src/components/mind/composer-queue.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const chatSource = ts.createSourceFile("chat-pane.tsx", readFileSync(new URL("../src/components/mind/chat-pane.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const cloudSource = ts.createSourceFile("cloud-picker.tsx", readFileSync(new URL("../src/components/mind/media/cloud-picker.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(file, predicate) {
  let result;
  const visit = (node) => { if (!result && predicate(node)) result = node; if (!result) ts.forEachChild(node, visit); };
  visit(file);
  assert.ok(result, "production callback or element exists");
  return result;
}
function expression(node, context = {}, file = source) {
  const js = ts.transpileModule(`const selected = ${node.getText(file)};`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return new Function(...Object.keys(context), js + "\nreturn selected;")(...Object.values(context));
}
function fn(name, context, file = source) { return expression(find(file, (n) => ts.isFunctionDeclaration(n) && n.name?.text === name), context, file); }
function effectContaining(text, context) {
  const call = find(source, (n) => ts.isCallExpression(n) && n.expression.getText(source) === "useEffect" && n.arguments[0]?.getText(source).includes(text));
  return { call, run: () => expression(call.arguments[0], context)() };
}
const defer = () => { let resolve; return { promise: new Promise((done) => { resolve = done; }), resolve: (value) => resolve(value) }; };

test("AA006/007/008: actual location effects preserve first Back entry, Settings pane history and the Intelligence thread", () => {
  const entries = ["/"];
  let index = 0;
  const location = { pathname: "/", search: "", hash: "", href: "https://mind.test/" };
  const updateLocation = (path) => Object.assign(location, { pathname: new URL(path, location.href).pathname, search: new URL(path, location.href).search, hash: new URL(path, location.href).hash, href: new URL(path, location.href).href });
  const listeners = new Map();
  const frames = [];
  let initialLocationResolved = false;
  const state = { view: "command", settingsPane: null, activeId: null, shareProjectId: null, openFileId: null, shareBotId: null, workTarget: { projectId: null, runId: null } };
  const context = {
    ready: true, applyingLocation: { current: false }, locationHistory: { current: "replace" },
    wsRef: { current: { chats: [{ id: "thread-a" }, { id: "thread-b" }], projects: [], files: [], agents: [] } },
    TITLES: { command: "Home", settings: "Settings", code: "Intelligence", chat: "Chat", files: "Library", connected: "Plugins", build: "Build" },
    resolveShare, shareWriteForView, shareWriteDropsMissing, writeShareSearch, sameShareLocation, settingsPaneFromSearch, shareMissLabel, workLocation,
    requestAnimationFrame: (work) => frames.push(work),
    window: { location, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: (type) => listeners.delete(type), history: { state: null, replaceState: (_s, _t, path) => { entries[index] = path; updateLocation(path); } } },
    router: { history: {
      push: (path) => { entries.splice(index + 1); entries.push(path); index++; updateLocation(path); },
      replace: (path) => { entries[index] = path; updateLocation(path); },
    } },
    setInitialLocationResolved: (value) => { initialLocationResolved = value; },
    setViewState: (value) => { state.view = value; }, setSettingsPane: (value) => { state.settingsPane = value; },
    setWorkTarget: (value) => { state.workTarget = value; },
    setActiveId: (value) => { state.activeId = value; }, setShareProjectId: (value) => { state.shareProjectId = value; },
    setShareBotId: (value) => { state.shareBotId = value; }, setOpenFileId: (value) => { state.openFileId = value; },
    setSpeakStageOpen: () => {}, setLibraryBand: () => {}, setLibraryProjectId: () => {}, setCardFocus: () => {}, setNotice: () => {},
  };
  const write = () => effectContaining("const nextWrite = shareWriteForView", { ...context, ...state }).run();
  const flush = () => { while (frames.length) frames.shift()(); };
  const back = () => { index--; updateLocation(entries[index]); listeners.get("popstate")(); write(); flush(); };
  const cleanup = effectContaining("const applyLocation =", context).run();
  assert.equal(initialLocationResolved, true);
  flush();
  state.view = "settings"; write();
  assert.deepEqual(entries, ["/", "/?section=settings"]);
  state.settingsPane = "voice"; write();
  assert.equal(location.search, "?section=settings&pane=voice");
  back(); assert.equal(state.settingsPane, null);
  back(); assert.equal(state.view, "command");
  state.view = "connected"; write();
  assert.deepEqual(entries, ["/", "/?section=connected"], "new navigation drops only the obsolete Forward branch");
  state.view = "code"; state.activeId = "thread-b"; write();
  assert.equal(location.search, "?section=code&chat=thread-b");
  listeners.get("popstate")(); flush();
  assert.equal(state.activeId, "thread-b");
  assert.equal(state.view, "code");
  state.view = "settings"; state.settingsPane = "general"; write();
  assert.equal(location.search, "?section=settings&pane=general");
  state.view = "connected"; write();
  assert.equal(location.search.includes("pane="), false);
  state.view = "build"; state.workTarget = { projectId: "project-a", runId: "abcde123".repeat(4) }; write();
  assert.match(location.search, /workProject=project-a/);
  state.view = "code"; write();
  assert.equal(location.search.includes("workRun="), false);
  back(); assert.equal(state.workTarget.projectId, "project-a");
  cleanup();
});

test("AA006: entering a Settings pane focuses its heading without overriding the restored position", () => {
  const scroller = { scrollTop: 405 };
  let focused = false;
  const frame = [];
  const { run, call } = effectContaining('document.getElementById("settings-heading")', {
    pageScrollRef: { current: scroller }, view: "settings", settingsPane: "voice",
    requestAnimationFrame: (work) => { frame.push(work); return 1; }, cancelAnimationFrame: () => {},
    document: { getElementById: (id) => id === "settings-heading" ? { focus: () => { focused = true; } } : null },
  });
  assert.ok(call.arguments[1].getText(source).includes("settingsPane"));
  run(); frame[0]();
  assert.equal(scroller.scrollTop, 405);
  assert.equal(focused, true);
});

function libraryFixture(overrides = {}) {
  const state = { workspace: { files: [], projects: [] }, openFileId: null, projectId: null, band: "files", staged: null, error: null, notice: null };
  const context = {
    draftOwner: "owner-a", account: { id: "owner-a" }, accountPending: false, turnOwner: { current: "owner-a" },
    view: "files", libraryProjectId: null, projectChoice: "hidden-composer-project", draftScope: "scope-a", draft: "",
    wsRef: { current: state.workspace }, addLocalFile,
    setNotice: (value) => { state.notice = value; }, setError: (value) => { state.error = value; },
    setWs: (update) => { state.workspace = typeof update === "function" ? update(state.workspace) : update; context.wsRef.current = state.workspace; },
    setOpenFileId: (id) => { state.openFileId = id; }, setLibraryProjectId: (id) => { state.projectId = id; }, setLibraryBand: (value) => { state.band = value; },
    setStaged: (value) => { state.staged = value; }, setExcerpt: () => {}, setPendingImages: () => {},
    cloudDestination: { current: null }, setCloudPickerOpen: () => {},
    ...overrides,
  };
  const target = context.view === "files" ? context.libraryProjectId : context.projectChoice;
  context.uploadDestination = { current: { owner: context.draftOwner, view: context.view, projectId: target, scope: context.draftScope } };
  context.prepareLibraryDocument = prepareLibraryDocument;
  context.saveLibraryDocument = saveLibraryDocument;
  context.accountOriginalFileStore = () => ({ put: async () => {}, remove: async () => {} });
  context.extractPdfText = undefined;
  return { context, state };
}
const textFile = (value = "fixture text") => new File([value], "fixture.txt", { type: "text/plain" });

test("AA011/014: actual Library upload uses its visible destination, rejects signed-out writes and ignores an old owner's pending read", async () => {
  const host = libraryFixture();
  await fn("onPicked", host.context)(textFile(), null);
  assert.equal(host.state.workspace.files[0].projectId, null, "All files never falls back to hidden chat project");
  assert.equal(host.state.openFileId, host.state.workspace.files[0].id);
  assert.equal(host.state.staged, null);
  const blocked = libraryFixture({ account: null });
  let reads = 0;
  await fn("onPicked", blocked.context)({ ...textFile(), arrayBuffer: async () => { reads++; return new ArrayBuffer(0); } }, null);
  assert.equal(reads, 0);
  assert.equal(blocked.state.workspace.files.length, 0);
  assert.match(blocked.state.error, /Sign in/);
  const deferred = defer();
  const pending = libraryFixture({ libraryProjectId: "project-a" });
  const upload = fn("onPicked", pending.context)({ name: "fixture.txt", type: "text/plain", size: 14, arrayBuffer: () => deferred.promise }, null);
  pending.context.turnOwner.current = "owner-b";
  deferred.resolve(new TextEncoder().encode("old-owner text").buffer);
  await upload;
  assert.equal(pending.state.workspace.files.length, 0);
});

test("AA012: actual Library preview excludes a previously opened file after project selection changes", () => {
  const filter = find(source, (n) => ts.isCallExpression(n) && n.expression.getText(source) === "ws.files.filter" && n.arguments[0]?.getText(source).includes("file.id === openFileId"));
  const ws = { files: [{ id: "file-a", projectId: "project-a" }, { id: "file-b", projectId: "project-b" }] };
  assert.deepEqual(expression(filter, { ws, openFileId: "file-a", libraryProjectId: "project-a" }).map((file) => file.id), ["file-a"]);
  assert.deepEqual(expression(filter, { ws, openFileId: "file-a", libraryProjectId: "project-b" }), []);
});

test("AA013: cloud Library uses the captured project and never stages chat text; changed chat scope cannot accept attachment", () => {
  const host = libraryFixture({ libraryProjectId: "project-a" });
  fn("openCloudPicker", host.context)("library");
  host.context.libraryProjectId = "project-b";
  fn("applyCloudAttach", host.context)({ kind: "text", name: "Drive copy", text: "fixture copy" });
  assert.equal(host.state.workspace.files[0].projectId, "project-a");
  assert.equal(host.state.projectId, "project-a");
  assert.equal(host.state.staged, null);
  const chat = libraryFixture({ view: "chat" });
  fn("openCloudPicker", chat.context)("chat");
  chat.context.draftScope = "scope-b";
  fn("applyCloudAttach", chat.context)({ kind: "text", name: "Drive copy", text: "fixture copy" });
  assert.equal(chat.state.staged, null);
  assert.match(chat.state.error, /conversation changed/);
});

test("AA013: actual CloudPicker purpose rejects Library images and ignores a response after close", async () => {
  let attached = 0;
  let closed = 0;
  const errors = [];
  const context = {
    requestEpoch: { current: 0 }, isOpen: { current: true }, purpose: "library",
    setBusy: () => {}, setError: (value) => errors.push(value), apiPrefix: () => "", authHeaders: () => ({}),
    fetch: async () => Response.json({ ok: true, kind: "image", dataUrl: "data:image/png;base64,fixture", name: "fixture.png" }),
    onAttach: () => { attached++; }, onClose: () => { closed++; }, onNotice: () => {},
  };
  const file = { id: "drive-file", source: "google_drive", name: "fixture" };
  await fn("pick", context, cloudSource)(file);
  assert.equal(attached, 0); assert.equal(closed, 0);
  assert.match(errors.at(-1), /Library saves text copies/);
  const response = defer();
  context.fetch = () => response.promise;
  const pending = fn("pick", context, cloudSource)(file);
  context.isOpen.current = false; context.requestEpoch.current++;
  response.resolve(Response.json({ ok: true, kind: "text", name: "late.txt", text: "late" }));
  await pending;
  assert.equal(attached, 0); assert.equal(closed, 0);
});

test("AA015: actual scheduler waits for identity and re-registers with the new owner's updater", () => {
  const timers = new Map();
  let next = 0;
  const updates = [];
  const context = {
    ready: true, accountPending: true, account: null,
    window: { setInterval: (callback) => { timers.set(++next, callback); return next; }, clearInterval: (id) => timers.delete(id) },
    wsRef: { current: { halted: false, schedules: [{ enabled: true, nextRunAt: "2000-01-01T00:00:00.000Z" }], runs: [] } },
    desktopActedRef: { current: new Set() }, spokenPcCommand: () => false, fetch: () => { throw new Error("No PC operation expected"); },
    runDueSchedules: (ws) => ({ ...ws, advanced: true }), tickFleet: (ws) => ws,
    setWs: () => updates.push("unresolved"),
  };
  const selector = "window.setInterval(step, 15000)";
  const pending = effectContaining(selector, context);
  assert.match(pending.call.arguments[1].getText(source), /accountPending.*account\?\.id.*setWs/);
  assert.equal(pending.run(), undefined); assert.equal(timers.size, 0);
  const stopA = effectContaining(selector, { ...context, accountPending: false, account: { id: "a" }, setWs: (ws) => { assert.equal(ws.advanced, true); updates.push("a"); } }).run();
  [...timers.values()][0](); stopA(); assert.equal(timers.size, 0);
  const stopB = effectContaining(selector, { ...context, accountPending: false, account: { id: "b" }, setWs: () => updates.push("b") }).run();
  [...timers.values()][0](); stopB();
  assert.deepEqual(updates, ["a", "b"]);
});

test("AA052: the actual queue removal button is keyboard-focusable, identifies its row and preserves other messages", () => {
  let queue = [{ id: "a", text: "first" }, { id: "b", text: "second" }, { id: "c", text: "third" }];
  const button = find(queueSource, (n) => ts.isJsxElement(n) && n.openingElement.tagName.getText(queueSource) === "button" && n.openingElement.attributes.getText(queueSource).includes("Remove queued message"));
  const rendered = expression(button, { React, item: queue[1], index: 1, onRemove: (id) => { queue = dropCued(queue, id); } }, queueSource);
  assert.equal(rendered.props.type, "button");
  assert.equal(rendered.props["aria-label"], "Remove queued message 2");
  rendered.props.onClick();
  assert.deepEqual(queue.map((item) => item.id), ["a", "c"]);
});

test("AA053: the actual Alt+P handler pins and unpins the selected result without navigating", () => {
  let ws = { pins: [] };
  const notices = [];
  let navigations = 0;
  const hit = { ref: "thread-a", label: "Intelligence task", meta: "Intelligence" };
  const palettePinKind = fn("palettePinKind", {});
  const pin = fn("pinPaletteHit", { palettePinKind, togglePin, setWs: (update) => { ws = update(ws); }, setNotice: (value) => notices.push(value) });
  const keydown = fn("onPaletteKeyDown", { paletteOpen: true, hits: [hit], paletteIndex: 0, pinPaletteHit: pin, paletteKeyAction,
    setPaletteOpen: () => {}, setPaletteIndex: () => {}, openPaletteHit: () => { navigations++; },
  });
  let prevented = 0;
  const event = { key: "p", altKey: true, metaKey: false, ctrlKey: false, preventDefault: () => { prevented++; } };
  keydown(event); assert.equal(ws.pins[0].ref, "thread-a"); assert.equal(ws.pins[0].kind, "chat");
  const pinnedNode = find(source, (n) => ts.isVariableDeclaration(n) && n.name.getText(source) === "selectedHitPinned");
  assert.equal(expression(pinnedNode.initializer, { hits: [hit], paletteIndex: 0, ws, palettePinKind }), true);
  const buttonNode = find(source, (n) => ts.isJsxElement(n) && n.openingElement.tagName.getText(source) === "button" && n.openingElement.attributes.getText(source).includes('aria-keyshortcuts="Alt+P"'));
  const pinnedButton = expression(buttonNode, { React, selectedHitPinned: true, hits: [hit], paletteIndex: 0, pinPaletteHit: pin });
  assert.equal(pinnedButton.props["aria-pressed"], true);
  assert.ok(renderToStaticMarkup(pinnedButton).includes("Unpin"));
  keydown(event); assert.equal(ws.pins.length, 0);
  assert.equal(expression(pinnedNode.initializer, { hits: [hit], paletteIndex: 0, ws, palettePinKind }), false);
  assert.deepEqual(notices, ["Pinned Intelligence task.", "Unpinned Intelligence task."]);
  assert.equal(navigations, 0); assert.equal(prevented, 2);
});

test("AA055: the actual shortcut indicator names the current platform", () => {
  const node = find(source, (n) => ts.isJsxElement(n) && n.openingElement.tagName.getText(source) === "span" && n.getText(source).includes('navigator.platform') && n.getText(source).includes('Ctrl K'));
  for (const [platform, expected] of [["Win32", "Ctrl K"], ["Linux x86_64", "Ctrl K"], ["MacIntel", "⌘K"]]) {
    assert.ok(renderToStaticMarkup(expression(node, { React, navigator: { platform } })).includes(expected));
  }
});

test("AA056: lifecycle announcements are atomic and streamed tokens are outside the live region", () => {
  const node = find(source, (n) => ts.isJsxElement(n) && n.openingElement.attributes.getText(source).includes('data-testid="generation-status"'));
  const region = expression(node, { React, generationStatus: "Reply completed." });
  assert.equal(region.props.role, "status");
  assert.equal(region.props["aria-live"], "polite"); assert.equal(region.props["aria-atomic"], "true");
  assert.equal(region.props.children, "Reply completed.");
  const article = find(chatSource, (n) => ts.isJsxElement(n) && n.openingElement.tagName.getText(chatSource) === "article" && n.getText(chatSource).includes("{liveText}"));
  const stream = expression(article, { React, modelTier: "fixture", liveText: "streamed tokens" }, chatSource);
  assert.equal(stream.props["aria-live"], undefined);
  const lifecycle = find(source, (n) => ts.isCallExpression(n) && n.expression.getText(source) === "setGenerationStatus" && n.arguments[0]?.getText(source).includes("result.ok"));
  for (const [result, expected] of [[{ ok: true }, "Reply completed."], [{ ok: false, error: "fixture-stop" }, "Reply stopped. Received text is kept as incomplete."], [{ ok: false, error: "failure" }, "Reply interrupted. Check the original send."]]) {
    assert.equal(expression(lifecycle.arguments[0], { result, STOPPED_REPLY: "fixture-stop" }), expected);
  }
});


test("AA054: actual modal uses the accessible dialog primitive and restores its invoking control without a Radix Trigger", (t) => {
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  let focuses = 0;
  class Element { isConnected = true; focus() { focuses++; } }
  const opener = new Element();
  globalThis.HTMLElement = Element;
  globalThis.document = { activeElement: opener };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = previousHTMLElement;
  });
  let tree;
  let dismisses = 0;
  function Fixture() {
    tree = ModalOverlay({ labelledBy: "fixture-heading", onDismiss: () => { dismisses++; }, children: React.createElement("a", { href: "#fixture-link" }, "Focusable link") });
    return null;
  }
  renderToStaticMarkup(React.createElement(Fixture));
  assert.equal(tree.type, Dialog.Root);
  assert.equal(tree.props.open, true);
  assert.notEqual(tree.props.modal, false, "Radix default is modal; background and focus trap remain active");
  const portal = tree.props.children;
  const content = React.Children.toArray(portal.props.children).find((child) => child.type === Dialog.Content);
  assert.equal(content.props["aria-labelledby"], "fixture-heading");
  content.props.onOpenAutoFocus();
  globalThis.document.activeElement = new Element();
  let prevented = 0;
  content.props.onCloseAutoFocus({ preventDefault: () => { prevented++; } });
  assert.equal(focuses, 1); assert.equal(prevented, 1);
  opener.isConnected = false;
  content.props.onCloseAutoFocus({ preventDefault: () => {} });
  assert.equal(focuses, 1, "do not focus a removed opener");
  content.props.onPointerDownOutside({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 2);
  tree.props.onOpenChange(false);
  assert.equal(dismisses, 1);
});

test("AA057: conflicting identity recovery explicitly ends both sessions and surfaces a failed sign-out", async () => {
  const button = find(source, (n) => ts.isJsxElement(n) && n.openingElement.tagName.getText(source) === "button" && n.getText(source).includes(">End conflicting sessions</button>"));
  const calls = [];
  const errors = [];
  const rendered = expression(button, { React, signOut: async (...args) => { calls.push(args); throw new Error("fixture sign-out unavailable"); }, setError: (message) => errors.push(message) });
  rendered.props.onClick();
  await Promise.resolve();
  assert.deepEqual(calls, [["/login", "both"]]);
  assert.deepEqual(errors, ["fixture sign-out unavailable"]);
});
