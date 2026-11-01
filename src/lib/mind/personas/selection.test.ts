import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addAgentFromTemplate, emptyFleet } from "../fleet.ts";
import { emptyWorkspace } from "../workspace.ts";
import { buildPersonaDirectory } from "./directory.ts";
import {
  PERSONA_SELECT_KEY,
  clearPersonaSelection,
  personaChatHref,
  readPersonaSelection,
  selectPersona,
  writePersonaSelection,
} from "./selection.ts";

describe("persona selection", () => {
  it("materializes a template then routes through agent-mode chat href", () => {
    const directory = buildPersonaDirectory(emptyFleet());
    const card = directory.cards.find((item) => item.templateName === "Personal assistant");
    assert.ok(card);
    const result = selectPersona(emptyWorkspace(), card!, "2026-11-01T13:00:00.000+01:00");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ws.agents.length, 1);
    assert.equal(result.selection.mode, "agent");
    assert.equal(result.selection.source, "template");
    assert.match(result.href, /view=chat/);
    assert.match(result.href, /mode=agent/);
    assert.match(result.href, /agentId=/);
  });

  it("reuses an already-saved agent without duplicating", () => {
    const made = addAgentFromTemplate(emptyWorkspace(), "Coding", "2026-11-01T13:00:00.000+01:00");
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const directory = buildPersonaDirectory(made.ws);
    const templateCard = directory.cards.find((item) => item.templateName === "Coding" && item.source === "template");
    assert.ok(templateCard);
    const result = selectPersona(made.ws, templateCard!);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ws.agents.length, 1);
    assert.equal(result.selection.agentId, made.agent.id);
  });

  it("persists selection for the pending CommandApp mount", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    };
    writePersonaSelection(storage, {
      agentId: "agent-1",
      agentName: "Research",
      mode: "agent",
      source: "saved",
      at: "2026-11-01T13:00:00.000+01:00",
    });
    assert.equal(memory.has(PERSONA_SELECT_KEY), true);
    const read = readPersonaSelection(storage);
    assert.equal(read?.agentId, "agent-1");
    assert.equal(read?.mode, "agent");
    clearPersonaSelection(storage);
    assert.equal(readPersonaSelection(storage), null);
    assert.match(personaChatHref("agent-1"), /agentId=agent-1/);
  });
});
