import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import { installTestDom } from "./test-dom.ts";

const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith("/retained-video.tsx")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
  return next(url, context);
} });
const { RetainedVideo } = await import("./retained-video.tsx");
hooks.deregister();
installTestDom();

test("AA083 an expired provider video keeps its receipt boundary and retries playback only", async () => {
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const url = "https://video.example/synthetic-expired-video";
  try {
    await act(async () => root.render(createElement(RetainedVideo, { url })));
    assert.match(container.textContent ?? "", /Temporary provider asset/);
    const video = container.querySelector("video")!;
    const event = { type: "error", target: video, currentTarget: video, bubbles: false, cancelable: false, defaultPrevented: false, timeStamp: 0, stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; } };
    await act(async () => video.dispatchEvent(event as unknown as Event));
    assert.equal(container.querySelector("video"), null);
    assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /unavailable.*temporary link may have expired/);
    assert.match(container.textContent ?? "", /receipt, not the video bytes/);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    assert.equal(container.querySelector("video")?.getAttribute("src"), url);
    assert.equal(container.querySelector('[role="status"]'), null);
    assert.equal(container.querySelector("a")?.getAttribute("href"), url);
  } finally { await act(async () => root.unmount()); container.remove?.(); }
});
