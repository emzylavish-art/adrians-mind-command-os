import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { SurfaceFailureHost } from "./surface-failure-host.ts";
import { emitFailure, registerFailureHandler, type FailureSurface, type MountedFailure } from "../../lib/mind/failure-mount.ts";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const surfaces: FailureSurface[] = ["mcp", "notion", "research", "serviceBoard", "supabase", "persona", "modelRoute"];

async function renderHost(surface: FailureSurface, outcome: { message: string }, retry: () => void) {
  const host = document.getElementById("root");
  if (!host) throw new Error("missing root");
  host.replaceChildren();
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(SurfaceFailureHost, {
        surface,
        message: outcome.message,
        outcome,
        retry,
      }),
    );
  });
  return root;
}

describe("mounted failure surfaces", () => {
  it("fires the registered handler and leaves the existing alert hidden", async () => {
    const outcome = { message: "Sol needs config. Missing SOL_API_KEY." };
    let seen: MountedFailure<typeof outcome> | null = null;
    const unregister = registerFailureHandler("modelRoute", (payload) => {
      seen = payload as MountedFailure<typeof outcome>;
    });
    const selection = { provider: "sol", logicRoute: "sol" };
    const root = await renderHost("modelRoute", outcome, () => selection);
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid=report-failure]")?.click();
    });
    assert.equal(seen?.outcome, outcome);
    assert.deepEqual(seen?.retry(), selection);
    assert.equal(document.querySelector("[data-testid=existing-failure-ui]"), null);
    unregister();
    root.unmount();
  });

  it("keeps the existing alert when no handler is registered", async () => {
    const outcome = { message: "Notion could not be reached. Nothing was changed." };
    assert.equal(emitFailure("notion", { outcome, retry: () => undefined, localCorrelationId: "local" }), false);
    const root = await renderHost("notion", outcome, () => undefined);
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid=report-failure]")?.click();
    });
    assert.equal(document.querySelector("[data-testid=existing-failure-ui]")?.textContent, outcome.message);
    root.unmount();
  });

  it("command-app and the persona directory call emitFailure for every surface except speak", () => {
    const app = readFileSync(new URL("./command-app.tsx", import.meta.url), "utf8");
    const persona = readFileSync(new URL("./persona-directory.tsx", import.meta.url), "utf8");
    assert.match(app, /emitFailure\("notion"/);
    assert.match(app, /emitFailure\("research"/);
    assert.match(app, /emitFailure\("serviceBoard"/);
    assert.match(app, /emitFailure\(\s*surface/);
    assert.match(persona, /emitFailure\("persona"/);
    assert.equal(app.includes('emitFailure("speak"'), false);
    assert.equal(persona.includes('emitFailure("speak"'), false);
    for (const surface of surfaces) {
      const blob = `${app}\n${persona}`;
      if (surface === "persona") assert.match(blob, /emitFailure\("persona"/);
      else if (surface === "notion" || surface === "research" || surface === "serviceBoard") {
        assert.match(blob, new RegExp(`emitFailure\\("${surface}"`));
      }
    }
    assert.match(app, /surfaceForReport/);
  });
});
