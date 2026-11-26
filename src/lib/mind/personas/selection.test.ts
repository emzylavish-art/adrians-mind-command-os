import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addAgentFromTemplate, emptyFleet } from "../fleet.ts";
import { emptyWorkspace, WORKSPACE_KEY } from "../workspace.ts";
import { buildPersonaDirectory } from "./directory.ts";
import {
  PERSONA_SELECT_KEY,
  applyPersonaHandoff,
  clearPersonaSelection,
  persistPersonaOpen,
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

  it("persists only the selection and applies a template to the latest workspace", () => {
    const card = buildPersonaDirectory(emptyFleet()).cards.find((item) => item.templateName === "Personal assistant")!;
    const picked = selectPersona(emptyWorkspace(), card);
    assert.equal(picked.ok, true); if (!picked.ok) return;
    const values = new Map<string, string>([[WORKSPACE_KEY, "must remain untouched"]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    assert.deepEqual(persistPersonaOpen(storage, picked.ws, picked.selection), { ok: true });
    assert.equal(values.get(WORKSPACE_KEY), "must remain untouched");
    const latest = emptyWorkspace(); latest.projects.push({ id: "new-project", name: "Created during handoff", description: "", createdAt: "2026-01-01" });
    const applied = applyPersonaHandoff(latest, readPersonaSelection(storage));
    assert.equal(applied.ws.projects[0]?.id, "new-project");
    assert.equal(applied.agent?.name, "Personal assistant");
    assert.equal(applyPersonaHandoff(applied.ws, readPersonaSelection(storage)).ws.agents.length, 1);
  });

  it("failed selection storage never replaces or partially writes a workspace", () => {
    const picked = selectPersona(emptyWorkspace(), buildPersonaDirectory(emptyFleet()).cards[0]!);
    assert.equal(picked.ok, true); if (!picked.ok) return;
    const calls: string[] = [];
    const storage = { setItem(key: string) { calls.push(key); throw new Error("quota"); } };
    assert.deepEqual(persistPersonaOpen(storage, picked.ws, picked.selection), { ok: false, workspacePersisted: false });
    assert.deepEqual(calls, [PERSONA_SELECT_KEY]);
  });

  it("a saved persona from another account does not import any workspace or agent", () => {
    const current = emptyWorkspace();
    const result = applyPersonaHandoff(current, { agentId: "other-account-agent", agentName: "Other", source: "saved", mode: "agent", at: "2026-01-01" });
    assert.equal(result.ws, current);
    assert.equal(result.agent, null);
    assert.equal(current.agents.length, 0);
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
