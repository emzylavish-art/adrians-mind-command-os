import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyFleet, addAgentFromTemplate, addCustomAgent, readFleet } from "../fleet.ts";
import { accountWorkspaceKey, emptyWorkspace, normalizeWorkspace, WORKSPACE_KEY } from "../workspace.ts";
import { buildPersonaDirectory } from "./directory.ts";
import { PERSONA_SELECT_KEY, readHandoff, applyPersonaHandoff, clearPersonaSelection, persistPersonaOpen, personaChatHref, readPersonaSelection, selectPersona, writePersonaSelection, PERSONA_SELECTION_TTL_MS, consumePersonaHandoff, personaSelectionKey } from "./selection.ts";

const now = Date.parse("2026-11-26T10:00:00.000Z");
const at = new Date(now).toISOString();
const owner = "owner-a";
function storageFixture() {
  const values = new Map<string, string>();
  const calls: string[] = [];
  return {
    values, calls,
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) { calls.push(key); values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}
function templateCard(name = "Coding") {
  return buildPersonaDirectory(emptyWorkspace()).cards.find((item) => item.source === "template" && item.templateName === name)!;
}
function pickTemplate() {
  const result = selectPersona(emptyWorkspace(), templateCard(), at);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.ok, true);
  return result;
}

describe("persona template identity", () => {
  it("materializes an exact catalog template and opens agent-mode chat", () => {
    const result = pickTemplate();
    assert.equal(result.ws.agents.length, 1);
    assert.equal(result.selection.templateId, "builtin:coding");
    assert.equal(result.selection.materialized, true);
    assert.equal(result.ws.agents[0]!.templateId, "builtin:coding");
    assert.match(result.href, /view=chat.*mode=agent.*agentId=/);
  });

  it("reuses a renamed template instance after workspace normalization", () => {
    const made = addAgentFromTemplate(emptyWorkspace(), "Coding", at);
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const renamed = normalizeWorkspace({ ...made.ws, agents: [{ ...made.agent, name: "My engineering assistant" }] });
    const result = selectPersona(renamed, templateCard(), at);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ws.agents.length, 1);
    assert.equal(result.selection.agentId, made.agent.id);
    assert.equal(result.selection.agentName, "My engineering assistant");
    assert.equal(result.selection.materialized, false);
  });

  it("does not hijack a same-name custom or legacy agent", () => {
    const custom = addCustomAgent(emptyWorkspace(), { name: "Coding", instructions: "Custom instructions", tools: ["search_notes"] }, at);
    assert.equal(custom.ok, true);
    if (!custom.ok) return;
    const result = selectPersona(custom.ws, templateCard(), at);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.ws.agents.length, 2);
    assert.notEqual(result.selection.agentId, custom.agent.id);
    assert.equal(result.ws.agents.find((item) => item.id === custom.agent.id)!.instructions, "Custom instructions");
    assert.equal(readFleet({ agents: [{ ...custom.agent, templateId: undefined }] }).agents[0]!.templateId, undefined);
  });
});

describe("account-scoped atomic persona handoff", () => {
  it("stores one complete envelope and recovers into only the owner's current workspace", () => {
    const picked = pickTemplate();
    const storage = storageFixture();
    storage.values.set(WORKSPACE_KEY, "unrelated-preview-copy");
    storage.values.set(accountWorkspaceKey("owner-b"), "other-account-copy");
    assert.deepEqual(persistPersonaOpen(storage, picked.ws, picked.selection, owner), { ok: true });
    assert.deepEqual(storage.calls, [personaSelectionKey(owner)]);
    assert.equal(readPersonaSelection(storage, "owner-b", now), null);
    const newerWorkspace = { ...emptyWorkspace(), halted: true };
    const consumed = consumePersonaHandoff(storage, owner, newerWorkspace, now + 10);
    assert.equal(consumed.status, "ready");
    if (consumed.status !== "ready") return;
    assert.equal(consumed.ws.halted, true);
    assert.equal(consumed.ws.agents[0]!.id, picked.selection.agentId);
    assert.equal(storage.values.get(WORKSPACE_KEY), "unrelated-preview-copy");
    assert.equal(storage.values.get(accountWorkspaceKey("owner-b")), "other-account-copy");
    assert.equal(readPersonaSelection(storage, owner, now + 10), null);
    assert.deepEqual(consumePersonaHandoff(storage, owner, consumed.ws, now + 20), { status: "none" });
  });

  it("storage rejection leaves no partial workspace or handoff", () => {
    const picked = pickTemplate();
    const calls: string[] = [];
    const storage = { setItem(key: string) { calls.push(key); throw new Error("quota"); } };
    assert.deepEqual(persistPersonaOpen(storage, picked.ws, picked.selection, owner), { ok: false, workspacePersisted: false });
    assert.deepEqual(calls, [personaSelectionKey(owner)]);
  });

  it("destination quota failure preserves exact template identity for a successful retry", () => {
    const picked = pickTemplate();
    const storage = storageFixture();
    persistPersonaOpen(storage, picked.ws, picked.selection, owner);
    const blockedStorage = { ...storage, setItem() { throw new Error("quota"); } };
    assert.equal(consumePersonaHandoff(blockedStorage, owner, emptyWorkspace(), now).status, "blocked");
    assert.equal(readPersonaSelection(storage, owner, now)!.agentId, picked.selection.agentId);
    const retried = consumePersonaHandoff(storage, owner, emptyWorkspace(), now + 1);
    assert.equal(retried.status, "ready");
    if (retried.status !== "ready") return;
    assert.equal(retried.ws.agents.length, 1);
    assert.equal(retried.ws.agents[0]!.id, picked.selection.agentId);
  });

  it("never resurrects a deleted saved agent or overwrites newer agent edits", () => {
    const picked = pickTemplate();
    const savedCard = buildPersonaDirectory(picked.ws).cards.find((card) => card.source === "saved")!;
    const saved = selectPersona(picked.ws, savedCard, at);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const storage = storageFixture();
    persistPersonaOpen(storage, saved.ws, saved.selection, owner);
    assert.equal(consumePersonaHandoff(storage, owner, emptyWorkspace(), now).status, "blocked");
    const updated = { ...saved.ws, agents: [{ ...saved.ws.agents[0]!, instructions: "A newer edit", name: "Renamed" }] };
    const ready = consumePersonaHandoff(storage, owner, updated, now + 1);
    assert.equal(ready.status, "ready");
    if (ready.status !== "ready") return;
    assert.equal(ready.ws.agents[0]!.instructions, "A newer edit");
    assert.equal(ready.selection.agentName, "Renamed");
  });
});

describe("persona handoff freshness and owner binding", () => {
  it("rejects missing, invalid, future, and expired timestamps without substituting now", () => {
    const picked = pickTemplate();
    for (const badAt of [undefined, "not-a-date", new Date(now + 1).toISOString(), new Date(now - PERSONA_SELECTION_TTL_MS).toISOString()]) {
      const storage = storageFixture();
      storage.values.set(personaSelectionKey(owner), JSON.stringify({ version: 2, ownerId: owner, selection: { ...picked.selection, at: badAt }, agent: picked.ws.agents[0] }));
      assert.equal(readPersonaSelection(storage, owner, now), null);
      assert.equal(consumePersonaHandoff(storage, owner, emptyWorkspace(), now).status, "invalid");
      assert.equal(storage.values.has(accountWorkspaceKey(owner)), false);
    }
  });

  it("rejects a handoff copied to a different account key", () => {
    const picked = pickTemplate();
    const storage = storageFixture();
    persistPersonaOpen(storage, picked.ws, picked.selection, owner);
    storage.values.set(personaSelectionKey("owner-b"), storage.values.get(personaSelectionKey(owner))!);
    assert.equal(consumePersonaHandoff(storage, "owner-b", emptyWorkspace(), now).status, "invalid");
    assert.equal(readPersonaSelection(storage, owner, now)!.agentId, picked.selection.agentId);
  });

  it("reads timestamp-valid legacy selections only for the explicit development owner", () => {
    const picked = pickTemplate();
    const storage = storageFixture();
    storage.values.set(PERSONA_SELECT_KEY, JSON.stringify(picked.selection));
    assert.equal(readPersonaSelection(storage, owner, now), null);
    assert.equal(readPersonaSelection(storage, "dev-user", now)!.agentId, picked.selection.agentId);
    clearPersonaSelection(storage, owner);
    assert.equal(storage.values.has(PERSONA_SELECT_KEY), true);
    clearPersonaSelection(storage, "dev-user");
    assert.equal(storage.values.has(PERSONA_SELECT_KEY), false);
  });

  it("writes and clears a selection only in its account", () => {
    const picked = pickTemplate();
    const storage = storageFixture();
    writePersonaSelection(storage, picked.selection, owner);
    assert.equal(readPersonaSelection(storage, owner, now)!.agentId, picked.selection.agentId);
    clearPersonaSelection(storage, owner);
    assert.equal(readPersonaSelection(storage, owner, now), null);
    assert.match(personaChatHref("agent-1"), /agentId=agent-1/);
  });
});

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
    const envelope = readHandoff(storage, "dev-user", Date.now()).handoff!;
    const applied = applyPersonaHandoff(latest, envelope.selection, null, envelope.agent);
    assert.equal(applied.agent?.id, picked.selection.agentId);
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
    assert.deepEqual(calls, [personaSelectionKey("dev-user")]);
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
      at: new Date().toISOString(),
    });
    assert.equal(memory.has(personaSelectionKey("dev-user")), true);
    const read = readPersonaSelection(storage);
    assert.equal(read?.agentId, "agent-1");
    assert.equal(read?.mode, "agent");
    clearPersonaSelection(storage);
    assert.equal(readPersonaSelection(storage), null);
    assert.match(personaChatHref("agent-1"), /agentId=agent-1/);
  });
});
