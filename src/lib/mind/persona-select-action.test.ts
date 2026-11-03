import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { emptyWorkspace } from "./workspace.ts";
import { emptyFleet } from "./fleet.ts";
import { buildPersonaDirectory } from "./personas/directory.ts";
import {
  PersonaSelectFailureBanner,
  cardFromPersonaSelectParams,
  onceRetry,
  runPersonaSelect,
  snapshotPersonaSelectParams,
} from "./persona-select-action.ts";

describe("persona-select-action", () => {
  it("snapshots card identity so Retry keeps identical select params", () => {
    const directory = buildPersonaDirectory(emptyFleet());
    const card = directory.cards.find((item) => item.templateName === "Personal assistant");
    assert.ok(card);
    const snap = snapshotPersonaSelectParams(card!);
    assert.equal(snap.cardId, card!.id);
    assert.equal(snap.templateName, "Personal assistant");
    assert.equal(snap.source, "template");
    assert.deepEqual(cardFromPersonaSelectParams(snap).tools, card!.tools);
  });

  it("ok:false select shows red banner; Retry re-opens identical card once", () => {
    const directory = buildPersonaDirectory(emptyFleet());
    const card = directory.cards.find((item) => item.source === "template");
    assert.ok(card);
    // Force incomplete card → selectPersona fails
    const bad = snapshotPersonaSelectParams({
      ...card!,
      source: "saved",
      agentId: "missing-agent-id",
      templateName: undefined,
    });
    const result = runPersonaSelect(emptyWorkspace(), bad);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.params.agentId, "missing-agent-id");
    assert.match(result.message, /not on this device/i);

    const html = renderToStaticMarkup(
      createElement(PersonaSelectFailureBanner, {
        state: { status: "error", kind: result.kind, message: result.message, params: result.params },
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /role="alert"/);
    assert.match(html, /data-testid="failure-banner"/);
    assert.match(html, /data-failure-kind="persona_select_failed"/);
    assert.match(html, /Retry/);
    assert.match(html, /text-danger/);

    let calls = 0;
    const retry = onceRetry(() => {
      calls += 1;
      return runPersonaSelect(emptyWorkspace(), result.params);
    });
    assert.ok(retry);
    retry!();
    retry!();
    assert.equal(calls, 1);
  });

  it("successful template select returns ok with selection", () => {
    const directory = buildPersonaDirectory(emptyFleet());
    const card = directory.cards.find((item) => item.templateName === "Personal assistant");
    assert.ok(card);
    const result = runPersonaSelect(emptyWorkspace(), snapshotPersonaSelectParams(card!), "2026-11-02T20:00:00.000-06:00");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.result.selection.source, "template");
    assert.match(result.result.href, /mode=agent/);
  });
});
