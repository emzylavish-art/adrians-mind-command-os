import { addAgentFromTemplate, type AgentDefinition } from "../fleet.ts";
import type { Workspace } from "../types.ts";

import type { PersonaCard } from "./directory.ts";

export const PERSONA_SELECT_KEY = "amcos.persona.select.v1";

export type PersonaSelection = {
  agentId: string;
  agentName: string;
  mode: "agent";
  source: "saved" | "template";
  templateName?: string;
  at: string;
};

export type PersonaSelectResult =
  | { ok: true; selection: PersonaSelection; ws: Workspace; href: string }
  | { ok: false; error: string };

/** Deep-link into the existing CommandApp chat path (agent mode + agent id). Mount that reads these params is pending when command-app is locked. */
export function personaChatHref(agentId: string): string {
  const params = new URLSearchParams({
    view: "chat",
    mode: "agent",
    agentId,
  });
  return `/?${params.toString()}`;
}

export function writePersonaSelection(storage: Pick<Storage, "setItem">, selection: PersonaSelection): void {
  storage.setItem(PERSONA_SELECT_KEY, JSON.stringify(selection));
}

export function readPersonaSelection(storage: Pick<Storage, "getItem">): PersonaSelection | null {
  try {
    const raw = storage.getItem(PERSONA_SELECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersonaSelection>;
    if (typeof parsed.agentId !== "string" || !parsed.agentId) return null;
    if (typeof parsed.agentName !== "string" || !parsed.agentName) return null;
    if (parsed.mode !== "agent") return null;
    if (parsed.source !== "saved" && parsed.source !== "template") return null;
    return {
      agentId: parsed.agentId,
      agentName: parsed.agentName.slice(0, 80),
      mode: "agent",
      source: parsed.source,
      templateName: typeof parsed.templateName === "string" ? parsed.templateName : undefined,
      at: typeof parsed.at === "string" ? parsed.at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function clearPersonaSelection(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(PERSONA_SELECT_KEY);
}

export type PersonaOpenStorage = Pick<Storage, "setItem">;

export type PersistPersonaOpenResult =
  | { ok: true }
  | { ok: false; workspacePersisted: boolean };

/** Store only an account-scoped selection. Workspace changes go through useMindWorkspace. */
export function persistPersonaOpen(storage: PersonaOpenStorage, _workspace: Workspace, selection: PersonaSelection): PersistPersonaOpenResult {
  try { storage.setItem(PERSONA_SELECT_KEY, JSON.stringify(selection)); return { ok: true }; }
  catch { return { ok: false, workspacePersisted: false }; }
}

/** A pending template handoff may create only that template in the current owner workspace. */
export function applyPersonaHandoff(ws: Workspace, selection: PersonaSelection | null, requestedId?: string | null): { ws: Workspace; agent: AgentDefinition | null } {
  const id = selection?.agentId || requestedId;
  const existing = ws.agents.find((agent) => agent.id === id && !agent.archived);
  if (existing) return { ws, agent: existing };
  if (selection?.source !== "template" || !selection.templateName) return { ws, agent: null };
  const matched = ws.agents.find((agent) => agent.name === selection.templateName && !agent.archived);
  if (matched) return { ws, agent: matched };
  const created = addAgentFromTemplate(ws, selection.templateName);
  return created.ok ? { ws: created.ws, agent: created.agent } : { ws, agent: null };
}

/**
 * Resolve a directory card into a saved agent + selection that routes through
 * the existing chat/orchestrator path (commandMode=agent → interpretCommand bot intent → enqueueRun).
 * Templates are materialized with addAgentFromTemplate first. Never invents a live remote bot.
 */
export function selectPersona(
  ws: Workspace,
  card: PersonaCard,
  now = new Date().toISOString(),
): PersonaSelectResult {
  if (card.live !== false) {
    return { ok: false, error: "Explore only opens local agents. Remote live bots are not supported." };
  }

  let next = ws;
  let agent: AgentDefinition | undefined;

  if (card.source === "saved" && card.agentId) {
    agent = next.agents.find((item) => item.id === card.agentId && !item.archived);
    if (!agent) return { ok: false, error: "That saved agent is not on this device." };
  } else if (card.source === "template" && card.templateName) {
    const existing = next.agents.find(
      (item) => !item.archived && item.name === card.templateName,
    );
    if (existing) {
      agent = existing;
    } else {
      const made = addAgentFromTemplate(next, card.templateName, now);
      if (!made.ok) return { ok: false, error: made.error };
      next = made.ws;
      agent = made.agent;
    }
  } else {
    return { ok: false, error: "That persona card is incomplete. Nothing was opened." };
  }

  const selection: PersonaSelection = {
    agentId: agent.id,
    agentName: agent.name,
    mode: "agent",
    source: card.source,
    templateName: card.templateName,
    at: now,
  };

  return {
    ok: true,
    selection,
    ws: next,
    href: personaChatHref(agent.id),
  };
}
