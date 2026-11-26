import { accountWorkspaceKey } from "../workspace.ts";
import { AGENT_TEMPLATES, addAgentFromTemplate, readFleet, type AgentDefinition } from "../fleet.ts";
import type { Workspace } from "../types.ts";

import type { PersonaCard } from "./directory.ts";

/** Legacy preview-only handoff. Signed-in accounts never inherit this unowned key. */
export const PERSONA_SELECT_KEY = "amcos.persona.select.v1";
export const PERSONA_SELECTION_TTL_MS = 5 * 60_000;

export type PersonaSelection = {
  agentId: string;
  agentName: string;
  mode: "agent";
  source: "saved" | "template";
  templateName?: string;
  templateId?: string;
  /** Only a template created by this selection may be added during handoff recovery. */
  materialized?: boolean;
  at: string;
};

type PersonaHandoff = { version: 2; ownerId: string; selection: PersonaSelection; agent?: AgentDefinition };

export type PersonaSelectResult =
  | { ok: true; selection: PersonaSelection; ws: Workspace; href: string }
  | { ok: false; error: string };

export function personaSelectionKey(ownerId: string): string {
  return `amcos.persona.open.v2.u.${encodeURIComponent(ownerId)}`;
}

/** Deep-link into the existing CommandApp agent-mode chat path. */
export function personaChatHref(agentId: string): string {
  const params = new URLSearchParams({ view: "chat", mode: "agent", agentId });
  return `/?${params.toString()}`;
}

function validSelection(value: unknown, now: number): PersonaSelection | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<PersonaSelection>;
  if (typeof parsed.agentId !== "string" || !parsed.agentId || parsed.agentId.length > 200) return null;
  if (typeof parsed.agentName !== "string" || !parsed.agentName) return null;
  if (parsed.mode !== "agent" || (parsed.source !== "saved" && parsed.source !== "template")) return null;
  // Missing/invalid/future timestamps must never be replaced with a fresh timestamp.
  if (typeof parsed.at !== "string" || !Number.isFinite(now)) return null;
  const at = Date.parse(parsed.at);
  if (!Number.isFinite(at) || at > now || now - at >= PERSONA_SELECTION_TTL_MS) return null;
  return {
    agentId: parsed.agentId,
    agentName: parsed.agentName.slice(0, 80),
    mode: "agent",
    source: parsed.source,
    templateName: typeof parsed.templateName === "string" ? parsed.templateName.slice(0, 80) : undefined,
    templateId: typeof parsed.templateId === "string" ? parsed.templateId : undefined,
    materialized: parsed.materialized === true,
    at: parsed.at,
  };
}

function readHandoff(storage: Pick<Storage, "getItem">, ownerId: string, now: number): { present: boolean; handoff: PersonaHandoff | null } {
  if (!ownerId) return { present: false, handoff: null };
  try {
    const raw = storage.getItem(personaSelectionKey(ownerId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersonaHandoff>;
      const selection = validSelection(parsed.selection, now);
      if (parsed.version !== 2 || parsed.ownerId !== ownerId || !selection) return { present: true, handoff: null };
      const agent = readFleet({ agents: [parsed.agent] }).agents[0];
      if (parsed.agent && (!agent || agent.id !== selection.agentId || agent.archived)) return { present: true, handoff: null };
      return { present: true, handoff: { version: 2, ownerId, selection, agent } };
    }
    // v1 did not bind an owner. Only the explicit development account may consume it.
    const legacy = ownerId === "dev-user" ? storage.getItem(PERSONA_SELECT_KEY) : null;
    if (!legacy) return { present: false, handoff: null };
    const selection = validSelection(JSON.parse(legacy), now);
    return { present: true, handoff: selection ? { version: 2, ownerId, selection } : null };
  } catch {
    return { present: true, handoff: null };
  }
}

export function writePersonaSelection(storage: Pick<Storage, "setItem">, selection: PersonaSelection, ownerId = "dev-user"): void {
  if (!ownerId) throw new Error("Sign in before selecting a persona.");
  storage.setItem(personaSelectionKey(ownerId), JSON.stringify({ version: 2, ownerId, selection } satisfies PersonaHandoff));
}

export function readPersonaSelection(storage: Pick<Storage, "getItem">, ownerId = "dev-user", now = Date.now()): PersonaSelection | null {
  return readHandoff(storage, ownerId, now).handoff?.selection ?? null;
}

export function clearPersonaSelection(storage: Pick<Storage, "removeItem">, ownerId = "dev-user"): void {
  storage.removeItem(personaSelectionKey(ownerId));
  if (ownerId === "dev-user") storage.removeItem(PERSONA_SELECT_KEY);
}

export type PersonaOpenStorage = Pick<Storage, "setItem">;
export type PersistPersonaOpenResult = { ok: true } | { ok: false; workspacePersisted: false };

/** Store only an account-scoped selection. Workspace changes go through useMindWorkspace. */
export function persistPersonaOpen(storage: PersonaOpenStorage, _workspace: Workspace, selection: PersonaSelection): PersistPersonaOpenResult {
  try { storage.setItem(PERSONA_SELECT_KEY, JSON.stringify(selection)); return { ok: true }; }
  catch { return { ok: false, workspacePersisted: false }; }
}

export type ConsumePersonaHandoffResult =
  | { status: "none" }
  | { status: "invalid" | "blocked"; error: string }
  | { status: "ready"; selection: PersonaSelection; ws: Workspace };

/** Apply only the selected template agent, preserving newer chats/settings and edits. */
export function consumePersonaHandoff(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  ownerId: string,
  workspace: Workspace,
  now = Date.now(),
): ConsumePersonaHandoffResult {
  const pending = readHandoff(storage, ownerId, now);
  if (!pending.present) return { status: "none" };
  if (!pending.handoff) {
    try { clearPersonaSelection(storage, ownerId); } catch { /* Invalid handoff remains unusable. */ }
    return { status: "invalid", error: "This persona selection expired or belongs to another account. Open it again from Explore." };
  }
  const { selection, agent: savedAgent } = pending.handoff;
  let current = workspace.agents.find((item) => item.id === selection.agentId);
  let next = workspace;
  if (!current && selection.source === "template" && selection.materialized === true && savedAgent && savedAgent.templateId === selection.templateId && AGENT_TEMPLATES.some((item) => item.templateId === selection.templateId)) {
    current = savedAgent;
    next = { ...workspace, agents: [savedAgent, ...workspace.agents] };
  }
  // A deleted/archived existing agent is never resurrected from a stale envelope.
  if (!current || current.archived) return { status: "blocked", error: "That saved agent is no longer available in this account. Choose another persona in Explore." };
  try {
    storage.setItem(accountWorkspaceKey(ownerId), JSON.stringify(next));
  } catch {
    return { status: "blocked", error: "Could not save the persona in this account. Its pending selection is preserved; free browser storage and retry." };
  }
  try { clearPersonaSelection(storage, ownerId); } catch { /* Saved agent ID makes a later retry idempotent. */ }
  return { status: "ready", selection: { ...selection, agentName: current.name }, ws: next };
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

/** Templates use immutable origin IDs; a custom agent's display name never grants template identity. */
export function selectPersona(ws: Workspace, card: PersonaCard, now = new Date().toISOString()): PersonaSelectResult {
  if (card.live !== false) return { ok: false, error: "Explore only opens local agents. Remote live bots are not supported." };
  let next = ws;
  let agent: AgentDefinition | undefined;
  let materialized = false;
  let templateId: string | undefined;
  if (card.source === "saved" && card.agentId) {
    agent = next.agents.find((item) => item.id === card.agentId && !item.archived);
    if (!agent) return { ok: false, error: "That saved agent is not on this device." };
  } else if (card.source === "template" && card.templateName) {
    // Legacy cards may name a catalog entry; existing agents are still matched only by origin ID.
    const template = AGENT_TEMPLATES.find((item) => card.templateId ? item.templateId === card.templateId : item.name === card.templateName);
    if (!template) return { ok: false, error: "That template is not in the library." };
    templateId = template.templateId;
    agent = next.agents.find((item) => !item.archived && item.templateId === templateId);
    if (!agent) {
      const made = addAgentFromTemplate(next, template.name, now);
      if (!made.ok) return { ok: false, error: made.error };
      next = made.ws;
      agent = made.agent;
      materialized = true;
    }
  } else {
    return { ok: false, error: "That persona card is incomplete. Nothing was opened." };
  }
  const selection: PersonaSelection = { agentId: agent.id, agentName: agent.name, mode: "agent", source: card.source, templateName: card.templateName, templateId, materialized, at: now };
  return { ok: true, selection, ws: next, href: personaChatHref(agent.id) };
}
