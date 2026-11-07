import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LogicRoutePickerHost } from "./logic-route-picker-host.ts";
import { installTestDom } from "./test-dom.ts";
import { readSelection, type LogicRoutePublic } from "../../lib/mind/logic-routes.ts";

installTestDom();

const sol: LogicRoutePublic = {
  id: "sol",
  label: "Sol",
  state: "configured",
  ready: true,
  model: "gpt-6-sol",
  missing: [],
  reason: "Sol is configured.",
  credential: "SOL_API_KEY",
  credentialFallback: null,
};

function mount(root: Root) {
  root.render(createElement(LogicRoutePickerHost, { routes: [sol], text: "persist sol" }));
}

describe("logic route reload", () => {
  it("keeps Sol selected in a fresh root that reads the same window.localStorage", async () => {
    localStorage.clear();
    const host = document.createElement("div");
    host.id = "root";
    document.body.appendChild(host);
    const first: Root = createRoot(host);
    await act(async () => {
      mount(first);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid=logic-route-sol]")?.click();
    });
    assert.equal(localStorage.getItem("amcos.logicRoute.v1"), "sol");
    await act(async () => {
      first.unmount();
    });
    const second: Root = createRoot(host);
    await act(async () => {
      mount(second);
    });
    const stored = readSelection(window.localStorage);
    assert.equal(stored.provider, "sol");
    assert.equal(stored.logicRoute, "sol");
    assert.equal(document.querySelector("[data-testid=logic-route-sol]")?.getAttribute("aria-checked"), "true");
    assert.equal(document.querySelector("[data-testid=turn-logic-route]")?.textContent, "sol");
    assert.equal(document.querySelector("[data-testid=turn-provider]")?.textContent, "sol");
    assert.match(document.querySelector("[data-testid=picker-label]")?.textContent ?? "", /Sol/);
    await act(async () => {
      second.unmount();
    });
  });
});
