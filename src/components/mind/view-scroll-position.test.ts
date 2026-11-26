import test from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type UIEvent } from "react";
import { createRoot } from "react-dom/client";
import { installTestDom } from "./test-dom.ts";
import { useViewScrollPosition } from "../../lib/mind/use-view-scroll-position.ts";

installTestDom();

test("AA055 mounted view scrolling survives DOM clamping and remains owner scoped", async () => {
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const element = document.createElement("div");
  const scroller = { current: element };
  let onScroll: (event: Pick<UIEvent<HTMLElement>, "currentTarget">) => void = () => {};
  function Host({ owner, view }: { owner: string | null; view: string }) {
    onScroll = useViewScrollPosition(scroller, owner, view);
    return createElement("span", {}, `${owner}:${view}`);
  }
  const render = (owner: string | null, view: string) => act(async () => root.render(createElement(Host, { owner, view })));
  try {
    await render("a", "settings:data");
    element.scrollTop = 1600;
    onScroll({ currentTarget: element });
    // Browser layout can clamp the old node before the previous layout cleanup.
    element.scrollTop = 140;
    await render("a", "projects");
    assert.equal(element.scrollTop, 0);
    await render("a", "settings:data");
    assert.equal(element.scrollTop, 1600, "Restore the observed reading position, not clamped old DOM");
    await render("b", "settings:data");
    assert.equal(element.scrollTop, 0, "Another owner does not inherit the saved position");
    await render("a", "settings:voice");
    assert.equal(element.scrollTop, 0, "Distinct Settings panes have independent contexts");
    await render("a", "settings:data");
    assert.equal(element.scrollTop, 1600);
  } finally { await act(async () => root.unmount()); container.remove?.(); }
});

test("AA055 pending restoration waits for async content and yields to actual user scrolling", async () => {
  const savedResize = globalThis.ResizeObserver;
  const observers: { notify: () => void; disconnected: boolean }[] = [];
  globalThis.ResizeObserver = class {
    state: { notify: () => void; disconnected: boolean };
    constructor(callback: ResizeObserverCallback) {
      this.state = { notify: () => callback([], this as unknown as ResizeObserver), disconnected: false };
      observers.push(this.state);
    }
    observe() {}
    unobserve() {}
    disconnect() { this.state.disconnected = true; }
  } as unknown as typeof ResizeObserver;
  const container = document.createElement("div"); document.body.appendChild(container);
  const element = document.createElement("div");
  let height = 2400, top = 0;
  Object.defineProperties(element, {
    scrollHeight: { get: () => height }, clientHeight: { get: () => 800 },
    scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, height - 800)); } },
    children: { get: () => [] },
  });
  const root = createRoot(container);
  const scroller = { current: element };
  let onScroll: (event: Pick<UIEvent<HTMLElement>, "currentTarget">) => void = () => {};
  function Host({ view }: { view: string }) { onScroll = useViewScrollPosition(scroller, "a", view); return createElement("span", {}, view); }
  const render = (view: string) => act(async () => root.render(createElement(Host, { view })));
  try {
    await render("settings:data");
    element.scrollTop = 1600; onScroll({ currentTarget: element });
    height = 900; await render("projects");
    height = 1200; await render("settings:data");
    assert.equal(element.scrollTop, 400, "Actual DOM is initially too short for the saved position");
    onScroll({ currentTarget: element });
    height = 2400; observers.at(-1)!.notify();
    assert.equal(element.scrollTop, 1600, "Async content restores the retained requested position");
    assert.equal(observers.at(-1)!.disconnected, true, "Completed restoration disconnects the observer");

    height = 900; await render("projects"); height = 1200; await render("settings:data");
    const pending = observers.at(-1)!;
    const event = { type: "wheel", target: element, currentTarget: element, bubbles: true, cancelable: false, defaultPrevented: false, timeStamp: 0, stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; } };
    element.dispatchEvent(event as unknown as Event);
    element.scrollTop = 100; onScroll({ currentTarget: element });
    height = 2400; pending.notify();
    assert.equal(element.scrollTop, 100, "A real user scroll cancels pending automatic restoration");
    assert.equal(pending.disconnected, true);
    await render("projects"); await render("settings:data");
    assert.equal(element.scrollTop, 100, "Subsequent visits keep the user's new position");
  } finally { await act(async () => root.unmount()); container.remove?.(); globalThis.ResizeObserver = savedResize; }
});
