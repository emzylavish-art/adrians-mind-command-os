import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ComposerTurnHost, type ComposerSelection } from "./composer-turn-host.ts";
import { installTestDom } from "./test-dom.ts";
import { registerFailureHandler, type MountedFailure } from "../../lib/mind/failure-mount.ts";

installTestDom();

const selection: ComposerSelection = { provider: "sol", modelTier: "Heavy", logicRoute: "sol" };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function render(fetchImpl: typeof fetch) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(createElement(ComposerTurnHost, { selection, fetchImpl, text: "hello sol" }));
  });
  return root;
}

describe("mounted composer turn", () => {
  it("sends the selected provider and logicRoute and renders a stubbed reply", async () => {
    const bodies: { provider?: string; logicRoute?: string }[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse(200, { ok: true, text: "Sol answered.", provider: "sol", model: "gpt-6-sol" });
    };
    const root = await render(fetchImpl);
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid=composer-send]")?.click();
    });
    assert.equal(bodies[0]?.provider, "sol");
    assert.equal(bodies[0]?.logicRoute, "sol");
    assert.equal(document.querySelector("[data-testid=composer-reply]")?.textContent, "Sol answered.");
    assert.equal(document.querySelector("[data-testid=failure-banner]"), null);
    await act(async () => {
      root.unmount();
    });
  });

  it("renders the failure banner and calls emitFailure for modelRoute", async () => {
    const seen: { current: MountedFailure<{ message: string }> | null } = { current: null };
    const unregister = registerFailureHandler("modelRoute", (payload: MountedFailure<unknown>) => {
      seen.current = payload as MountedFailure<{ message: string }>;
    });
    const fetchImpl: typeof fetch = async () => jsonResponse(503, { ok: false, error: "The model route timed out." });
    const root = await render(fetchImpl);
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid=composer-send]")?.click();
    });
    assert.equal(seen.current?.outcome.message, "The model route timed out.");
    assert.equal(document.querySelector("[data-testid=failure-banner]")?.textContent, "The model route timed out.");
    assert.equal(document.querySelector("[data-testid=composer-reply]"), null);
    unregister();
    await act(async () => {
      root.unmount();
    });
  });
});
