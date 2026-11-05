import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addAgentFromTemplate, emptyFleet } from "../fleet.ts";
import { emptyWorkspace, WORKSPACE_KEY } from "../workspace.ts";
import { buildPersonaDirectory } from "./directory.ts";
import {
  PERSONA_SELECT_KEY,
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

  it("persists workspace before persona handoff, so an immediate reload retains a template agent", () => {
    const card = buildPersonaDirectory(emptyFleet()).cards.find((item) => item.templateName === "Personal assistant");
    assert.ok(card);
    const picked = selectPersona(emptyWorkspace(), card!, "2026-11-04T08:00:00.000Z");
    assert.equal(picked.ok, true);
    if (!picked.ok) return;
    const values = new Map<string, string>();
    const calls: string[] = [];
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { calls.push(key); values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    assert.deepEqual(persistPersonaOpen(storage, picked.ws, picked.selection), { ok: true });
    assert.equal(calls[0], WORKSPACE_KEY);
    assert.equal(calls[1], PERSONA_SELECT_KEY);
    const restored = JSON.parse(values.get(WORKSPACE_KEY) ?? "{}") as ReturnType<typeof emptyWorkspace>;
    assert.ok(restored.agents.some((item) => item.id === picked.selection.agentId));
    assert.equal(readPersonaSelection(storage)?.agentId, picked.selection.agentId);
  });

  it("reports workspace persistence failure", () => {
    const card = buildPersonaDirectory(emptyFleet()).cards[0]!;
    const picked = selectPersona(emptyWorkspace(), card);
    assert.equal(picked.ok, true);
    if (!picked.ok) return;
    const calls: string[] = [];
    const storage = { setItem(key: string) { calls.push(key); throw new Error("quota"); } };
    assert.deepEqual(persistPersonaOpen(storage, picked.ws, picked.selection), { ok: false, workspacePersisted: false });
    assert.deepEqual(calls, [WORKSPACE_KEY]);
  });

  it("retains the agent and reports partial persistence if selection storage fails", () => {
    const card = buildPersonaDirectory(emptyFleet()).cards[0]!;
    const picked = selectPersona(emptyWorkspace(), card);
    assert.equal(picked.ok, true);
    if (!picked.ok) return;
    const values = new Map<string, string>();
    const calls: string[] = [];
    const storage = { setItem(key: string, value: string) { calls.push(key); if (key === PERSONA_SELECT_KEY) throw new Error("denied"); values.set(key, value); } };
    assert.deepEqual(persistPersonaOpen(storage, picked.ws, picked.selection), { ok: false, workspacePersisted: true });
    assert.deepEqual(calls, [WORKSPACE_KEY, PERSONA_SELECT_KEY]);
    const restored = JSON.parse(values.get(WORKSPACE_KEY) ?? "{}") as ReturnType<typeof emptyWorkspace>;
    assert.ok(restored.agents.some((item) => item.id === picked.selection.agentId));
    const retried = selectPersona(restored, card);
    assert.equal(retried.ok, true);
    if (retried.ok) {
      assert.equal(retried.selection.agentId, picked.selection.agentId);
      assert.equal(retried.ws.agents.length, 1);
    }
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
