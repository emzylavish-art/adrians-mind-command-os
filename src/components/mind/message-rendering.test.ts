import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import { installTestDom } from "./test-dom.ts";
import { useWorkspaceRecordSize } from "../../lib/mind/workspace-metrics.ts";

const base = new URL("../../../", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      const root = new URL(`src/${specifier.slice(2)}`, base);
      const target = [".ts", ".tsx", "/index.ts", ""].map((extension) => new URL(root.href + extension)).find((url) => existsSync(fileURLToPath(url)));
      if (target) return next(target.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(base.href + "src/") && url.endsWith(".tsx")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});
const { MemoAnswerTabs, MemoMessageBody, useMessageMediaActions } = await import("./stable-message-body.ts");
hooks.deregister();
installTestDom();

test("AA062 actual historical message components do not reparse on stream updates and retain current action handlers", async () => {
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  let calls = 0, usedHandler = -1;
  const images = [{ dataUrl: "data:image/png;base64,aGVsbG8=", name: "Fixture" }];
  const history = "HISTORICAL_FIXTURE\n**Saved answer**\n```ts\nconst answer = 42;\n```";
  const originalSplit = String.prototype.split;
  String.prototype.split = function (this: string, separator: unknown, limit?: number) {
    if (String(this).startsWith("HISTORICAL_FIXTURE") && separator === "```") calls++;
    return Reflect.apply(originalSplit, this, [separator, limit]) as string[];
  } as typeof String.prototype.split;
  function Host({ tick, text }: { tick: number; text: string }) {
    const actions = useMessageMediaActions({ onEditImagine() {}, onSaveImage() { usedHandler = tick; }, onDownloadImage() {} });
    return createElement("main", {}, createElement(MemoAnswerTabs, { text, images, onEditImagine: actions.editImage, onSaveImage: actions.saveImage, onDownloadImage: actions.downloadImage }), createElement(MemoMessageBody, { text: "Historical user message", onEditImagine: actions.editImage, onSaveImage: actions.saveImage, onDownloadImage: actions.downloadImage }), createElement(MemoAnswerTabs, { text: `Live token ${tick}` }));
  }
  try {
    await act(async () => root.render(createElement(Host, { tick: 0, text: history })));
    const mountedCalls = calls;
    assert.ok(mountedCalls > 0, "Counts actual production splitBlocks work, not a mocked child");
    for (let tick = 1; tick <= 20; tick++) await act(async () => root.render(createElement(Host, { tick, text: history })));
    assert.equal(calls, mountedCalls, "Twenty live-token renders did not parse completed historical text again");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="image-save"]')!.click());
    assert.equal(usedHandler, 20, "Stable memoized image action delegates to the newest owner handler");
    await act(async () => root.render(createElement(Host, { tick: 21, text: history + "\nChanged historical text" })));
    assert.ok(calls > mountedCalls, "A real historical edit is reparsed and rendered");
    assert.match(container.textContent ?? "", /Changed historical text/);
  } finally {
    String.prototype.split = originalSplit;
    await act(async () => root.unmount()); container.remove?.();
  }
});

test("AA064 actual visibility-aware workspace hook serializes only visible Data and changed records", async () => {
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  let serialized = 0;
  const first = { toJSON() { serialized++; return { text: "Fixture workspace" }; } };
  const second = { toJSON() { serialized++; return { text: "Changed workspace" }; } };
  function Host(props: { workspace: unknown; view: string; pane: string | null; tick: number }) { return createElement("span", {}, `${useWorkspaceRecordSize(props.workspace, props.view, props.pane)} bytes · ${props.tick}`); }
  try {
    await act(async () => root.render(createElement(Host, { workspace: first, view: "settings", pane: null, tick: 0 })));
    assert.equal(serialized, 0, "An unselected Settings pane does not serialize workspace records");
    assert.match(container.textContent ?? "", /^0 bytes/);
    await act(async () => root.render(createElement(Host, { workspace: first, view: "chat", pane: "data", tick: 0 })));
    assert.equal(serialized, 0, "A remembered Data selection is not an active Data screen");
    await act(async () => root.render(createElement(Host, { workspace: first, view: "settings", pane: "voice", tick: 1 })));
    assert.equal(serialized, 0);
    await act(async () => root.render(createElement(Host, { workspace: first, view: "settings", pane: "data", tick: 2 })));
    assert.equal(serialized, 1); assert.match(container.textContent ?? "", /^28 bytes/);
    for (let tick = 3; tick <= 15; tick++) await act(async () => root.render(createElement(Host, { workspace: first, view: "settings", pane: "data", tick })));
    assert.equal(serialized, 1, "Unrelated clock/live state does not serialize the same workspace");
    await act(async () => root.render(createElement(Host, { workspace: second, view: "chat", pane: "data", tick: 16 })));
    assert.equal(serialized, 1, "Leaving Settings prevents new workspace serialization");
    await act(async () => root.render(createElement(Host, { workspace: second, view: "settings", pane: "data", tick: 17 })));
    assert.equal(serialized, 2);
  } finally { await act(async () => root.unmount()); container.remove?.(); }
});
